import { useAuth } from '../context/AuthContext';
import { Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import api from '../config/api';
import '../styles/Admin.css';

interface Topic {
  id: string;
  name: string;
}

interface Book {
  id: string;
  title: string;
  topic_name: string;
  topic_id: string;
  processing_status: 'pending' | 'processing' | 'complete' | 'failed';
  error_message?: string;
  created_at: string;
  uploaded_by_name: string;
  uploaded_by_email: string;
}

export default function Admin() {
  const { user } = useAuth();
  const [topics, setTopics] = useState<Topic[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Form state
  const [title, setTitle] = useState('');
  const [topicInput, setTopicInput] = useState('');
  const [selectedTopicId, setSelectedTopicId] = useState('');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [showTopicSuggestions, setShowTopicSuggestions] = useState(false);

  if (user?.role !== 'admin') {
    return <Navigate to="/chat" />;
  }

  useEffect(() => {
    loadTopics();
    loadBooks();
  }, []);

  const loadTopics = async () => {
    try {
      const response = await api.get('/api/topics');
      const allTopics = response.data.filter((t: any) => t.id !== null); // Exclude "All Topics"
      setTopics(allTopics);
    } catch (err) {
      console.error('Failed to load topics:', err);
    }
  };

  const loadBooks = async () => {
    try {
      setLoading(true);
      const response = await api.get('/api/admin/books');
      setBooks(response.data);
    } catch (err) {
      console.error('Failed to load books:', err);
      setError('Failed to load books');
    } finally {
      setLoading(false);
    }
  };

  const handleTopicInputChange = (value: string) => {
    setTopicInput(value);
    setShowTopicSuggestions(value.length > 0);

    // Check if exact match exists
    const exactMatch = topics.find(
      t => t.name.toLowerCase() === value.toLowerCase()
    );
    if (exactMatch) {
      setSelectedTopicId(exactMatch.id);
    } else {
      setSelectedTopicId(''); // Will create new topic
    }
  };

  const handleTopicSelect = (topic: Topic) => {
    setTopicInput(topic.name);
    setSelectedTopicId(topic.id);
    setShowTopicSuggestions(false);
  };

  const filteredTopics = topics.filter(t =>
    t.name.toLowerCase().includes(topicInput.toLowerCase())
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.type !== 'application/pdf') {
        setError('Please select a PDF file');
        return;
      }
      if (file.size > 400 * 1024 * 1024) {
        setError('File size must be less than 400MB');
        return;
      }
      setPdfFile(file);
      setError('');
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');

    if (!title.trim()) {
      setError('Title is required');
      return;
    }

    if (!topicInput.trim()) {
      setError('Topic is required');
      return;
    }

    if (!pdfFile) {
      setError('Please select a PDF file');
      return;
    }

    try {
      setUploading(true);

      // Create or get topic
      let topicId = selectedTopicId;
      if (!topicId) {
        const topicResponse = await api.post('/api/admin/topics', {
          name: topicInput.trim()
        });
        topicId = topicResponse.data.id;
        await loadTopics(); // Refresh topics list
      }

      // Upload PDF
      const formData = new FormData();
      formData.append('pdf', pdfFile);
      formData.append('title', title.trim());
      formData.append('topicId', topicId);

      // Don't set Content-Type manually - let axios set it with the correct boundary
      const response = await api.post('/api/admin/books/upload', formData);

      if (response.data.success) {
        setSuccessMessage(
          `Successfully uploaded "${title}". Processing in background...`
        );
        // Reset form
        setTitle('');
        setTopicInput('');
        setSelectedTopicId('');
        setPdfFile(null);
        // Reload books to show the new book with 'pending' status
        await loadBooks();
      } else {
        setError(response.data.error || 'Failed to upload PDF');
      }
    } catch (err: any) {
      console.error('Upload error:', err);
      setError(
        err.response?.data?.error ||
        err.message ||
        'Failed to upload PDF'
      );
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (bookId: string, bookTitle: string) => {
    if (!confirm(`Are you sure you want to delete "${bookTitle}"? This will remove all associated chunks and cannot be undone.`)) {
      return;
    }

    try {
      await api.delete(`/api/admin/books/${bookId}`);
      setSuccessMessage(`Successfully deleted "${bookTitle}"`);
      await loadBooks();
    } catch (err: any) {
      console.error('Delete error:', err);
      setError(
        err.response?.data?.error ||
        'Failed to delete book'
      );
    }
  };

  const getStatusBadge = (status: string) => {
    const badges: Record<string, string> = {
      pending: 'status-pending',
      processing: 'status-processing',
      complete: 'status-complete',
      failed: 'status-failed'
    };
    return badges[status] || '';
  };

  return (
    <div className="admin-container">
      <div className="admin-header">
        <h1>Admin Portal</h1>
        <a href="/chat" className="back-link">Back to Chat</a>
      </div>

      {error && (
        <div className="alert alert-error">
          {error}
          <button onClick={() => setError('')} className="alert-close">×</button>
        </div>
      )}

      {successMessage && (
        <div className="alert alert-success">
          {successMessage}
          <button onClick={() => setSuccessMessage('')} className="alert-close">×</button>
        </div>
      )}

      {/* Upload Form */}
      <div className="upload-section">
        <h2>Upload PDF</h2>
        <form onSubmit={handleUpload} className="upload-form">
          <div className="form-group">
            <label htmlFor="title">Title</label>
            <input
              type="text"
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter book title"
              disabled={uploading}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="topic">Topic</label>
            <div className="autocomplete-wrapper">
              <input
                type="text"
                id="topic"
                value={topicInput}
                onChange={(e) => handleTopicInputChange(e.target.value)}
                onFocus={() => setShowTopicSuggestions(topicInput.length > 0)}
                onBlur={() => setTimeout(() => setShowTopicSuggestions(false), 200)}
                placeholder="Select existing or create new topic"
                disabled={uploading}
                required
              />
              {showTopicSuggestions && filteredTopics.length > 0 && (
                <div className="autocomplete-suggestions">
                  {filteredTopics.map(topic => (
                    <div
                      key={topic.id}
                      className="autocomplete-item"
                      onMouseDown={() => handleTopicSelect(topic)}
                    >
                      {topic.name}
                    </div>
                  ))}
                </div>
              )}
              {topicInput && !selectedTopicId && (
                <small className="form-hint">
                  Will create new topic: "{topicInput}"
                </small>
              )}
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="pdf">PDF File</label>
            <input
              type="file"
              id="pdf"
              accept="application/pdf"
              onChange={handleFileChange}
              disabled={uploading}
              required
            />
            {pdfFile && (
              <small className="form-hint">
                Selected: {pdfFile.name} ({(pdfFile.size / (1024 * 1024)).toFixed(2)} MB)
              </small>
            )}
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={uploading}
          >
            {uploading ? 'Processing...' : 'Upload and Process'}
          </button>
        </form>
      </div>

      {/* Books List */}
      <div className="books-section">
        <h2>Uploaded Books</h2>
        {loading ? (
          <p>Loading books...</p>
        ) : books.length === 0 ? (
          <p className="empty-state">No books uploaded yet</p>
        ) : (
          <div className="books-table-wrapper">
            <table className="books-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Topic</th>
                  <th>Status</th>
                  <th>Uploaded By</th>
                  <th>Date</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {books.map(book => (
                  <tr key={book.id}>
                    <td>{book.title}</td>
                    <td>{book.topic_name}</td>
                    <td>
                      <span className={`status-badge ${getStatusBadge(book.processing_status)}`}>
                        {book.processing_status}
                      </span>
                      {book.error_message && (
                        <div className="error-tooltip" title={book.error_message}>
                          ⚠️ {book.error_message}
                        </div>
                      )}
                    </td>
                    <td>{book.uploaded_by_name}</td>
                    <td>{new Date(book.created_at).toLocaleDateString()}</td>
                    <td>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => handleDelete(book.id, book.title)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
