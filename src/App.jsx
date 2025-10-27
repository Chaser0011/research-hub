import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { 
    getFirestore, collection, query, onSnapshot, 
    addDoc, updateDoc, deleteDoc, doc, where, 
    serverTimestamp, getDocs, 
    runTransaction, // Import for atomic read-modify-write
    setLogLevel, 
} from 'firebase/firestore';

// --- FIREBASE CONFIGURATION & INITIALIZATION ---
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// New Public Collection Paths for Collaboration
const getPaperCollectionPath = () => `/artifacts/${appId}/public/data/papers`;
const getCommentCollectionPath = () => `/artifacts/${appId}/public/data/comments`;

// --- UI COMPONENTS ---

// 1. Paper Card for the List View
const PaperCard = ({ paper, onSelect, onLike, userId }) => {
    // Check if the current user ID is in the likedBy array (default to empty array)
    const likedBy = paper.likedBy || [];
    const isLiked = likedBy.includes(userId);
    const likeCount = paper.likes || 0;

    return (
        <div 
            className="p-4 bg-white rounded-xl shadow-md hover:shadow-lg transition border-l-4 border-indigo-500 flex flex-col justify-between"
        >
            <div onClick={() => onSelect(paper)} className="cursor-pointer">
                <h3 className="text-xl font-bold text-gray-800">{paper.title}</h3>
                <p className="text-sm text-indigo-600 font-medium mt-1">
                    Author: <span className="font-mono text-xs bg-indigo-100 p-1 rounded">{paper.authorId.substring(0, 8)}...</span>
                </p>
                <p className="text-xs text-gray-500 mt-2 line-clamp-2">{paper.content}</p>
            </div>
            
            <div className="mt-3 pt-3 border-t border-gray-100 flex justify-between items-center">
                <div className="flex items-center space-x-1">
                    {/* Heart icon filled based on like status */}
                    <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 ${isLiked ? 'text-red-500' : 'text-gray-400'}`} viewBox="0 0 24 24" fill={isLiked ? "currentColor" : "none"} stroke={isLiked ? "currentColor" : "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                    </svg>
                    <span className="text-sm font-bold text-gray-700">{likeCount}</span>
                </div>
                <button
                    onClick={(e) => { e.stopPropagation(); onLike(paper.id); }} // Stop propagation to prevent card selection
                    className={`flex items-center px-3 py-1 text-white text-sm rounded-lg transition active:scale-95 disabled:opacity-50 ${isLiked ? 'bg-red-500 hover:bg-red-600' : 'bg-pink-500 hover:bg-pink-600'}`}
                    disabled={!userId}
                >
                    {isLiked ? 'Unlike' : 'Like'}
                </button>
            </div>
        </div>
    );
};

// 2. Comment Item
const CommentItem = ({ comment, currentUserId, onDelete }) => {
    const isAuthor = currentUserId === comment.userId;
    return (
        <div className="p-3 mb-2 bg-gray-50 rounded-lg shadow-inner flex justify-between items-start">
            <div>
                <p className="text-gray-700">{comment.text}</p>
                <p className="text-xs text-gray-500 mt-1">
                    <span className="font-mono bg-gray-200 px-1 rounded-sm">{comment.userId.substring(0, 8)}...</span> 
                    {comment.timestamp ? ` - ${new Date(comment.timestamp.seconds * 1000).toLocaleString()}` : ''}
                </p>
            </div>
            {isAuthor && (
                <button
                    onClick={() => onDelete(comment.id)}
                    className="text-red-500 hover:text-red-700 transition active:scale-90 ml-4 p-1"
                    aria-label="Delete comment"
                >
                    {/* Delete Icon */}
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                </button>
            )}
        </div>
    );
};

// 3. Delete Confirmation Modal (Custom UI replacement for window.prompt)
const DeleteConfirmationModal = ({ onConfirm, onCancel, title }) => (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white p-6 rounded-xl shadow-2xl max-w-sm w-full transform transition-all">
            <h3 className="text-xl font-bold text-red-600 mb-4">Confirm Deletion</h3>
            <p className="text-gray-700 mb-6">
                Are you sure you want to permanently delete the paper: **"{title}"**? This action is irreversible and will also delete all associated comments.
            </p>
            <div className="flex justify-end space-x-3">
                <button
                    onClick={onCancel}
                    className="px-4 py-2 bg-gray-300 text-gray-800 rounded-lg font-medium hover:bg-gray-400 transition active:scale-95"
                >
                    Cancel
                </button>
                <button
                    onClick={onConfirm}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg font-bold hover:bg-red-700 transition active:scale-95"
                >
                    Yes, Delete Paper
                </button>
            </div>
        </div>
    </div>
);


// --- MAIN APPLICATION COMPONENT ---
const App = () => {
    // Firebase State
    const [db, setDb] = useState(null);
    const [userId, setUserId] = useState(null);
    const [dbError, setDbError] = useState(null); 
    const [loading, setLoading] = useState(true);

    // Application State
    const [papers, setPapers] = useState([]);
    const [selectedPaper, setSelectedPaper] = useState(null);
    const [comments, setComments] = useState([]);
    
    // Form/Input State
    const [newPaperTitle, setNewPaperTitle] = useState('');
    const [newPaperContent, setNewPaperContent] = useState('');
    const [newCommentText, setNewCommentText] = useState('');
    const [isEditing, setIsEditing] = useState(false);
    const [editTitle, setEditTitle] = useState('');
    const [editContent, setEditContent] = useState('');
    
    // NEW: Search State
    const [searchQuery, setSearchQuery] = useState('');

    // UI State for custom confirmation
    const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);

    // 1. Initialize Firebase and Authentication
    useEffect(() => {
        try {
            if (Object.keys(firebaseConfig).length === 0) {
                setDbError("Firebase config not available. App is read-only and non-functional.");
                setLoading(false);
                return;
            }

            // setLogLevel('Debug');
            const app = initializeApp(firebaseConfig);
            const firestore = getFirestore(app);
            const firebaseAuth = getAuth(app);
            
            setDb(firestore);
            
            const authenticate = async () => {
                try {
                    if (initialAuthToken) {
                        await signInWithCustomToken(firebaseAuth, initialAuthToken);
                    } else {
                        await signInAnonymously(firebaseAuth);
                    }
                } catch (e) {
                    console.error("Authentication failed:", e);
                    setDbError("Authentication failed.");
                }
            };
            
            authenticate();

            onAuthStateChanged(firebaseAuth, (user) => {
                if (user) {
                    setUserId(user.uid);
                    console.log("User authenticated with UID:", user.uid);
                } else {
                    setUserId(null);
                }
                setLoading(false);
            });

        } catch (e) {
            console.error("Firebase Initialization Error:", e);
            setDbError(`Firebase Init Error: ${e.message}.`);
            setLoading(false);
        }
    }, []);

    // 2. Read (R): Real-time Listener for Papers List
    useEffect(() => {
        if (!db || !userId) return;

        const papersCollectionRef = collection(db, getPaperCollectionPath());
        const papersQuery = query(papersCollectionRef);

        const unsubscribe = onSnapshot(papersQuery, (snapshot) => {
            const fetchedPapers = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setPapers(fetchedPapers); 
            setDbError(null); 
            
            // Re-select the paper with updated data if it's currently open
            if (selectedPaper) {
                const updatedPaper = fetchedPapers.find(p => p.id === selectedPaper.id);
                if (updatedPaper) {
                    setSelectedPaper(updatedPaper);
                } else {
                    // If the selected paper was deleted by someone else
                    setSelectedPaper(null); 
                }
            }
        }, (error) => {
            console.error("Firestore Papers Read Error:", error);
            setDbError(`Failed to load papers: ${error.message}`);
        });

        return () => unsubscribe();
    }, [db, userId, selectedPaper]); 

    // 3. Read (R): Real-time Listener for Comments (when a paper is selected)
    useEffect(() => {
        if (!db || !userId || !selectedPaper) {
            setComments([]);
            return;
        }

        const commentsCollectionRef = collection(db, getCommentCollectionPath());
        const commentsQuery = query(
            commentsCollectionRef, 
            where("paperId", "==", selectedPaper.id)
        );

        const unsubscribe = onSnapshot(commentsQuery, (snapshot) => {
            const fetchedComments = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            // Sort client-side by timestamp if available
            fetchedComments.sort((a, b) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0));
            
            setComments(fetchedComments);
        }, (error) => {
            console.error("Firestore Comments Read Error:", error);
            setDbError(`Failed to load comments: ${error.message}`);
        });

        return () => unsubscribe();
    }, [db, userId, selectedPaper]); 

    // --- Paper CRUD Operations ---

    // Create (C): Add new research paper
    const handleAddPaper = async () => {
        if (!db || !userId || newPaperTitle.trim() === '' || newPaperContent.trim() === '') return;
        
        const paperPayload = {
            title: newPaperTitle.trim(),
            content: newPaperContent.trim(),
            authorId: userId,
            likes: 0, // Initialize likes count
            likedBy: [], // Initialize list of user IDs who liked the paper
            createdAt: serverTimestamp(),
        };

        setNewPaperTitle('');
        setNewPaperContent('');
        
        try {
            const papersCollectionRef = collection(db, getPaperCollectionPath());
            await addDoc(papersCollectionRef, paperPayload);
        } catch (e) {
            console.error("Error adding paper:", e);
            setDbError(`Failed to save paper: ${e.message}`);
        }
    };

    // Update (U): Edit selected paper content
    const handleUpdatePaper = async () => {
        if (!db || !userId || !selectedPaper || editTitle.trim() === '' || editContent.trim() === '') return;
        
        try {
            const paperDocRef = doc(db, getPaperCollectionPath(), selectedPaper.id);
            await updateDoc(paperDocRef, {
                title: editTitle.trim(),
                content: editContent.trim(),
                updatedAt: serverTimestamp(),
            });
            setIsEditing(false); // Exit edit mode
        } catch (e) {
            console.error("Error updating paper:", e);
            setDbError(`Failed to update paper: ${e.message}`);
        }
    };
    
    // Update (U): Toggle Like/Unlike on a paper (Robust Transaction)
    const handleLikePaper = async (paperId) => {
        if (!db || !userId) return;

        const paperDocRef = doc(db, getPaperCollectionPath(), paperId);

        try {
            // Use a transaction to ensure atomic update of both 'likes' and 'likedBy'
            await runTransaction(db, async (transaction) => {
                const paperDoc = await transaction.get(paperDocRef);
                if (!paperDoc.exists()) {
                    throw new Error("Document does not exist!");
                }
                
                const data = paperDoc.data();
                // Initialize likedBy as an empty array if it doesn't exist
                const likedBy = data.likedBy || [];
                
                const isCurrentlyLiked = likedBy.includes(userId);
                let newLikesCount = data.likes || 0;
                let newLikedBy;

                if (isCurrentlyLiked) {
                    // Unlike: Remove user ID from array and decrement count
                    newLikesCount = Math.max(0, newLikesCount - 1);
                    newLikedBy = likedBy.filter(uid => uid !== userId);
                } else {
                    // Like: Add user ID to array and increment count
                    // Check if the user ID is already present (shouldn't happen with the check above, but for robustness)
                    if (!likedBy.includes(userId)) {
                        newLikesCount += 1;
                        newLikedBy = [...likedBy, userId];
                    } else {
                        // User already liked, no change
                        newLikedBy = likedBy;
                    }
                }

                // Perform the atomic update within the transaction
                transaction.update(paperDocRef, {
                    likes: newLikesCount,
                    likedBy: newLikedBy
                });
            });
            
        } catch (e) {
            console.error("Error toggling like:", e);
            setDbError(`Failed to toggle like: ${e.message}`);
        }
    };

    // Delete (D) Step 1: Show Confirmation UI
    const handleDeletePaperClick = () => {
        if (selectedPaper && isPaperAuthor) {
            setShowDeleteConfirmation(true);
        }
    };

    // Delete (D) Step 2: Execute Deletion (REPLACED window.prompt)
    const executeDeletePaper = async () => {
        if (!db || !userId || !selectedPaper || !isPaperAuthor) {
            setShowDeleteConfirmation(false);
            return;
        }

        const paperIdToDelete = selectedPaper.id;

        try {
            // 1. Delete the paper document
            const paperDocRef = doc(db, getPaperCollectionPath(), paperIdToDelete);
            await deleteDoc(paperDocRef);

            // 2. Clear comments for this paper
            const commentsRef = collection(db, getCommentCollectionPath());
            const commentsSnapshot = await getDocs(query(commentsRef, where("paperId", "==", paperIdToDelete)));
            commentsSnapshot.docs.forEach(async (d) => {
                // Deleting comments outside of a transaction but with a specific query/loop
                await deleteDoc(doc(db, getCommentCollectionPath(), d.id)); 
            });

            setSelectedPaper(null); // Return to list view
        } catch (e) {
            console.error("Error deleting paper:", e);
            setDbError(`Failed to delete paper: ${e.message}`);
        } finally {
            setShowDeleteConfirmation(false); // Ensure modal is closed
        }
    };

    // --- Comment CRUD Operations ---

    // Create (C): Add new comment
    const handleAddComment = async () => {
        if (!db || !userId || !selectedPaper || newCommentText.trim() === '') return;
        
        const commentPayload = {
            paperId: selectedPaper.id,
            userId: userId,
            text: newCommentText.trim(),
            timestamp: serverTimestamp(),
        };

        setNewCommentText('');
        
        try {
            const commentsCollectionRef = collection(db, getCommentCollectionPath());
            await addDoc(commentsCollectionRef, commentPayload);
        } catch (e) {
            console.error("Error adding comment:", e);
            setDbError(`Failed to save comment: ${e.message}`);
        }
    };

    // Delete (D): Remove comment
    const handleDeleteComment = async (commentId) => {
        if (!db || !userId) return;

        try {
            const commentDocRef = doc(db, getCommentCollectionPath(), commentId);
            await deleteDoc(commentDocRef);
        } catch (e) {
            console.error("Error deleting comment:", e);
            setDbError(`Failed to delete comment: ${e.message}`);
        }
    };

    // Handle initial edit setup
    const handleEditClick = () => {
        if (selectedPaper) {
            setEditTitle(selectedPaper.title);
            setEditContent(selectedPaper.content);
            setIsEditing(true);
        }
    };

    const isPaperAuthor = selectedPaper && userId === selectedPaper.authorId;

    // Filter papers based on search query
    const filteredPapers = papers.filter(paper => {
        const queryLower = searchQuery.toLowerCase();
        return (
            paper.title?.toLowerCase().includes(queryLower) ||
            paper.content?.toLowerCase().includes(queryLower)
        );
    });

    // --- RENDER LOGIC (List View vs. Detail View) ---

    const renderListView = () => (
        <div className="flex flex-col md:flex-row gap-8">
            {/* Paper Submission Form (Create) */}
            <div className="md:w-1/3 p-4 bg-indigo-50 rounded-xl shadow-inner border-t-4 border-indigo-500 h-fit">
                <h2 className="text-2xl font-semibold text-indigo-700 mb-4">Submit Research Paper</h2>
                <input
                    type="text"
                    placeholder="Paper Title"
                    value={newPaperTitle}
                    onChange={(e) => setNewPaperTitle(e.target.value)}
                    className="w-full p-2 mb-3 border border-indigo-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                    disabled={!userId}
                />
                <textarea
                    placeholder="Literature Review Content..."
                    value={newPaperContent}
                    onChange={(e) => setNewPaperContent(e.target.value)}
                    rows="8"
                    className="w-full p-2 mb-4 border border-indigo-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                    disabled={!userId}
                />
                <button
                    onClick={handleAddPaper}
                    className="w-full bg-indigo-600 text-white p-3 rounded-lg font-bold shadow-md hover:bg-indigo-700 transition active:scale-95 disabled:bg-indigo-300"
                    disabled={!userId || newPaperTitle.trim() === '' || newPaperContent.trim() === ''}
                >
                    Publish Paper
                </button>
            </div>

            {/* Papers List (Read & Like) */}
            <div className="md:w-2/3">
                <h2 className="text-2xl font-semibold text-gray-700 mb-4 border-b pb-2">
                    Available Research Documents
                </h2>
                {/* Search Bar (NEW) */}
                <div className="mb-4">
                    <div className="relative">
                        <input
                            type="text"
                            placeholder="Search papers by title or content..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full p-3 pl-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition"
                        />
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                    </div>
                </div>
                
                <div className="space-y-4">
                    {filteredPapers.length === 0 ? (
                        <p className="text-center text-gray-500 py-8">
                            {searchQuery ? `No results found for "${searchQuery}".` : `No papers published yet. Be the first to submit one!`}
                        </p>
                    ) : (
                        filteredPapers.map(paper => (
                            <PaperCard 
                                key={paper.id} 
                                paper={paper} 
                                onSelect={setSelectedPaper} 
                                onLike={handleLikePaper}
                                userId={userId}
                            />
                        ))
                    )}
                </div>
            </div>
        </div>
    );

    const renderDetailView = () => (
        <div className="w-full">
            <button 
                onClick={() => { setSelectedPaper(null); setIsEditing(false); }} 
                className="text-indigo-600 hover:text-indigo-800 font-semibold mb-4 flex items-center transition"
            >
                {/* Back Arrow Icon */}
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                Back to Dashboard
            </button>

            {/* Paper Content Area */}
            <div className="p-6 bg-white rounded-xl shadow-2xl mb-8">
                {isEditing ? (
                    // Update (U) - Edit Mode
                    <div>
                        <input
                            type="text"
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            className="w-full text-3xl font-extrabold text-gray-800 mb-4 p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                        />
                        <textarea
                            value={editContent}
                            onChange={(e) => setEditContent(e.target.value)}
                            rows="15"
                            className="w-full text-base text-gray-700 mb-4 p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                        />
                        <div className="flex space-x-3">
                            <button
                                onClick={handleUpdatePaper}
                                className="bg-green-600 text-white p-3 rounded-lg font-bold hover:bg-green-700 transition active:scale-95 disabled:bg-green-300"
                            >
                                Save Changes
                            </button>
                            <button
                                onClick={() => setIsEditing(false)}
                                className="bg-gray-400 text-white p-3 rounded-lg font-bold hover:bg-gray-500 transition active:scale-95"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                ) : (
                    // Read (R) - Display Mode
                    <div>
                        <h2 className="text-3xl font-extrabold text-gray-800 mb-2">{selectedPaper.title}</h2>
                        <div className="flex justify-between items-center mb-4 border-b pb-2">
                            <p className="text-sm text-indigo-600 font-medium">
                                Author: <span className="font-mono text-xs bg-indigo-100 p-1 rounded">{selectedPaper.authorId.substring(0, 8)}...</span>
                            </p>
                            {isPaperAuthor && (
                                <div className="space-x-2">
                                    <button 
                                        onClick={handleEditClick}
                                        className="text-blue-500 hover:text-blue-700 font-medium transition"
                                    >
                                        Edit
                                    </button>
                                    <button 
                                        onClick={handleDeletePaperClick}
                                        className="text-red-500 hover:text-red-700 font-medium transition"
                                    >
                                        Delete
                                    </button>
                                </div>
                            )}
                        </div>
                        <div className="text-base text-gray-700 whitespace-pre-wrap leading-relaxed">
                            {selectedPaper.content}
                        </div>
                        {/* Display Likes in Detail View */}
                        <div className="mt-4 p-3 bg-pink-50 rounded-lg flex items-center space-x-2 w-fit">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-red-500" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
                            <span className="text-sm font-semibold text-red-600">
                                {selectedPaper.likes || 0} Total Likes
                            </span>
                        </div>
                    </div>
                )}
            </div>

            {/* Comments Section */}
            <div className="p-6 bg-gray-100 rounded-xl shadow-inner">
                <h3 className="text-xl font-semibold text-gray-700 mb-4 border-b pb-2">Comments ({comments.length})</h3>
                
                {/* Comment Submission (Create) */}
                <div className="mb-6">
                    <textarea
                        placeholder={userId ? "Add a comment..." : "Sign in to add a comment."}
                        value={newCommentText}
                        onChange={(e) => setNewCommentText(e.target.value)}
                        rows="3"
                        className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                        disabled={!userId}
                    />
                    <button
                        onClick={handleAddComment}
                        className="mt-2 bg-indigo-500 text-white p-2 rounded-lg font-semibold hover:bg-indigo-600 transition active:scale-95 disabled:bg-indigo-300"
                        disabled={!userId || newCommentText.trim() === ''}
                    >
                        Submit Comment
                    </button>
                </div>

                {/* Comments List (Read) */}
                <div className="space-y-4">
                    {comments.length > 0 ? (
                        comments.map(comment => (
                            <CommentItem 
                                key={comment.id} 
                                comment={comment} 
                                currentUserId={userId} 
                                onDelete={handleDeleteComment} 
                            />
                        ))
                    ) : (
                        <p className="text-center text-gray-500 py-4">No comments yet. Start the discussion!</p>
                    )}
                </div>
            </div>
        </div>
    );

    return (
        <div className="min-h-screen bg-gray-100 p-4 sm:p-8 font-sans flex justify-center">
            <div className="w-full max-w-4xl">
                <h1 className="text-4xl font-extrabold text-indigo-700 mb-6 text-center">
                    Collaborative Research Hub
                </h1>
                
                {/* User ID and Status */}
                <div className="mb-6">
                    {userId && (
                        <div className="text-sm text-gray-600 bg-white p-3 rounded-xl shadow-md break-all flex justify-between items-center">
                            <span className="font-semibold text-indigo-700">Your ID:</span>
                            <span className="font-mono bg-indigo-100 px-2 py-1 rounded text-xs">{userId}</span>
                        </div>
                    )}
                    {dbError && (
                        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mt-4 text-sm">
                            <strong className="font-bold">Error:</strong>
                            <span className="block sm:inline ml-2">{dbError}</span>
                        </div>
                    )}
                </div>

                {loading && !userId && (
                    <p className="text-center text-indigo-500 py-8">Authenticating and connecting to the database...</p>
                )}

                {/* Main Content Render */}
                {selectedPaper ? renderDetailView() : renderListView()}

                {/* Custom Delete Confirmation Modal */}
                {showDeleteConfirmation && selectedPaper && (
                    <DeleteConfirmationModal
                        onConfirm={executeDeletePaper}
                        onCancel={() => setShowDeleteConfirmation(false)}
                        title={selectedPaper.title}
                    />
                )}

            </div>
        </div>
    );
};

export default App;
