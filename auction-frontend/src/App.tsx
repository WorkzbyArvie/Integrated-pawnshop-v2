import { Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import Home from './pages/Home';
import ListingDetail from './pages/ListingDetail';
import KycVerification from './pages/KycVerification';
import Terms from './pages/Terms';
import MyBids from './pages/MyBids';
import MyWinnings from './pages/MyWinnings';
import Profile from './pages/Profile';

function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/listing/:id" element={<ListingDetail />} />
        <Route path="/kyc" element={<KycVerification />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/my-bids" element={<MyBids />} />
        <Route path="/my-winnings" element={<MyWinnings />} />
        <Route path="/profile" element={<Profile />} />
      </Routes>
    </AuthProvider>
  );
}

export default App;
