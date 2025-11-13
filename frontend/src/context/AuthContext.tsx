import React, { createContext, useContext, useEffect, useState } from 'react';
import axios from '../config/api';

interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'educator';
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: () => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check authentication status on mount
    console.log('[AuthContext] Checking authentication...');
    axios.get('/auth/me', { withCredentials: true })
      .then(response => {
        console.log('[AuthContext] User authenticated:', response.data);
        setUser(response.data);
      })
      .catch((error) => {
        console.log('[AuthContext] Not authenticated:', error.response?.status || error.message);
        setUser(null);
      })
      .finally(() => {
        console.log('[AuthContext] Auth check complete');
        setLoading(false);
      });
  }, []);

  const login = () => {
    // Redirect to backend OAuth endpoint
    const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
    window.location.href = `${API_URL}/auth/google`;
  };

  const logout = async () => {
    try {
      await axios.post('/auth/logout', {}, { withCredentials: true });
      setUser(null);
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
