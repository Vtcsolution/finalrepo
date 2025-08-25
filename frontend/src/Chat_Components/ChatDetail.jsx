import { useEffect, useRef, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Send, Smile, Timer, StopCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import MessageBubble from "./Message_Bubble";
import { useAuth } from "@/All_Components/screen/AuthContext";
import FeedbackModal from "./FeedbackModal";
import axios from "axios";
import { io } from "socket.io-client";
import EmojiPicker from "emoji-picker-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";

// Utility function to debounce async operations
const debounce = (func, wait) => {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    return new Promise((resolve) => {
      timeout = setTimeout(() => resolve(func(...args)), wait);
    });
  };
};

export default function ChatDetail({ chat, onBack, onSendMessage }) {
  const [messageInput, setMessageInput] = useState("");
  const [timerActive, setTimerActive] = useState(false);
  const [timerDuration, setTimerDuration] = useState(0);
  const [isSending, setIsSending] = useState(false);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [isStoppingSession, setIsStoppingSession] = useState(false);
  const [credits, setCredits] = useState(null);
  const [isFreePeriod, setIsFreePeriod] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [error, setError] = useState(null);
  const [freeSessionStarted, setFreeSessionStarted] = useState(false);
  const [freeSessionUsed, setFreeSessionUsed] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [activePaidSession, setActivePaidSession] = useState(null);
  const { user, loading: authLoading, error: authError } = useAuth();
  const messagesEndRef = useRef(null);
  const socketRef = useRef(null);
  const modalDebounceRef = useRef(null);
  const emojiPickerRef = useRef(null);

  // Format timer duration in MM:SS
  const formatTimerDuration = (seconds) => {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}:${secs < 10 ? "0" : ""}${secs}`;
  };

  // Debounce modal state changes
  const setModalState = (key, value) => {
    if (modalDebounceRef.current) clearTimeout(modalDebounceRef.current);
    modalDebounceRef.current = setTimeout(() => {
      if (key === "showFeedbackModal") setShowFeedbackModal(value);
    }, 500);
  };

  // Handle click outside to close emoji picker
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(event.target)) {
        setShowEmojiPicker(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Fetch session status with retry logic
  const fetchSessionStatus = async (retries = 3, delay = 1000) => {
    if (!chat?._id || authLoading || !user || authError) return;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const token = localStorage.getItem("accessToken") || user.token;
        const response = await axios.get(
          `${import.meta.env.VITE_BASE_URL}/api/session-status/${chat._id}`,
          { withCredentials: true, headers: { Authorization: `Bearer ${token}` } }
        );
        const { isFree, remainingFreeTime, paidTimer, credits, status, freeSessionUsed } = response.data;
        setIsFreePeriod(isFree);
        setCredits(credits);
        setTimerDuration(isFree ? remainingFreeTime : paidTimer);
        setTimerActive(isFree || (status === "paid" && paidTimer > 0));
        setFreeSessionStarted(isFree || status !== "new");
        setFreeSessionUsed(freeSessionUsed);
        if (status === "paid") {
          setActivePaidSession({ psychicId: chat._id, paidTimer });
        } else {
          setActivePaidSession(null);
        }
        setError(null);
        return; // Success, exit retry loop
      } catch (error) {
        if (attempt === retries) {
          setError(`Failed to fetch session status after ${retries} attempts: ${error.response?.data?.error || error.message}`);
          toast.error("Failed to fetch session status. Please try again.");
        } else {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
  };

  // Initialize WebSocket and handle session updates
  useEffect(() => {
    if (!user || !chat?._id) return;

    socketRef.current = io(import.meta.env.VITE_BASE_URL, { withCredentials: true });

    socketRef.current.on("connect", () => {
      socketRef.current.emit("join", user._id);
    });

    socketRef.current.on("sessionUpdate", (data) => {
      if (data.psychicId === chat._id) {
        setIsFreePeriod(data.isFree);
        setTimerActive(data.isFree || (data.status === "paid" && data.paidTimer > 0));
        setFreeSessionStarted(data.isFree || data.status !== "new");
        setFreeSessionUsed(data.freeSessionUsed || false);
        setTimerDuration(data.isFree ? data.remainingFreeTime : data.paidTimer);
        setCredits(data.credits);
        if (data.status === "paid") {
          setActivePaidSession({ psychicId: data.psychicId, paidTimer: data.paidTimer });
        } else if (data.status === "stopped" || data.status === "insufficient_credits") {
          setActivePaidSession(null);
          setTimerActive(false);
          setTimerDuration(0);
          if (data.showFeedbackModal) setModalState("showFeedbackModal", true);
        }
      } else {
        if (data.status === "paid" && data.paidTimer > 0) {
          setActivePaidSession({ psychicId: data.psychicId, paidTimer: data.paidTimer });
        } else if (data.status === "stopped" && activePaidSession?.psychicId === data.psychicId) {
          setActivePaidSession(null);
        }
      }
    });

    socketRef.current.on("creditsUpdate", (data) => {
      if (data.userId === user._id) {
        setCredits(data.credits);
      }
    });

    socketRef.current.on("connect_error", (err) => {
      setError("Failed to connect to real-time updates. Falling back to polling.");
      const pollingInterval = setInterval(() => fetchSessionStatus(), 2000); // Reduced polling interval
      socketRef.current.pollingInterval = pollingInterval;
    });

    // Initial fetch to ensure credits and session state are loaded
    fetchSessionStatus();

    return () => {
      if (socketRef.current) {
        clearInterval(socketRef.current.pollingInterval);
        socketRef.current.disconnect();
      }
    };
  }, [user, chat?._id]);

  // Auto-start free session if not started or used
  useEffect(() => {
    if (chat?._id && user && !authLoading && !authError && !freeSessionStarted && !freeSessionUsed) {
      startFreeSession();
    }
  }, [chat?._id, user, authLoading, authError, freeSessionStarted, freeSessionUsed]);

  // Start free session
  const startFreeSession = async () => {
    if (!chat?._id || authLoading || !user || authError || freeSessionStarted || freeSessionUsed) return;
    try {
      const token = localStorage.getItem("accessToken") || user.token;
      const response = await axios.post(
        `${import.meta.env.VITE_BASE_URL}/api/start-free-session/${chat._id}`,
        {},
        { withCredentials: true, headers: { Authorization: `Bearer ${token}` } }
      );
      setIsFreePeriod(response.data.isFree);
      setTimerDuration(response.data.remainingFreeTime);
      setTimerActive(response.data.isFree);
      setCredits(response.data.credits);
      setFreeSessionStarted(true);
      setFreeSessionUsed(response.data.freeSessionUsed);
      setError(null);
      await fetchSessionStatus(); // Sync state after starting
    } catch (error) {
      if (error.response?.data?.error === "Free minute already used") {
        setFreeSessionUsed(true);
        setIsFreePeriod(false);
        setTimerActive(false);
        setTimerDuration(0);
        await fetchSessionStatus();
      } else {
        setError(`Failed to start free session: ${error.response?.data?.error || error.message}`);
        toast.error("Failed to start free session. Please try again.");
      }
    }
  };

  // Start paid session with debounce
  const startPaidSession = debounce(async () => {
    if (credits === null || credits <= 0 || isStartingSession) {
      toast.error("Out of credits. Please buy more to continue.");
      return;
    }
    setIsStartingSession(true);
    try {
      const token = localStorage.getItem("accessToken") || user.token;
      const response = await axios.post(
        `${import.meta.env.VITE_BASE_URL}/api/start-paid-session/${chat._id}`,
        {},
        { withCredentials: true, headers: { Authorization: `Bearer ${token}` } }
      );
      setIsFreePeriod(false);
      setTimerDuration(response.data.paidTimer);
      setTimerActive(true);
      setCredits(response.data.credits);
      setFreeSessionUsed(true);
      setActivePaidSession({ psychicId: chat._id, paidTimer: response.data.paidTimer });
      setError(null);
      await fetchSessionStatus(); // Sync state after starting
      toast.success("Paid session started successfully!");
    } catch (error) {
      setError(`Failed to start paid session: ${error.response?.data?.error || error.message}`);
      toast.error(error.response?.data?.error || "Failed to start paid session. Please try again.");
    } finally {
      setIsStartingSession(false);
    }
  }, 500);

  // Stop paid session with debounce
  const stopPaidSession = debounce(async () => {
    if (!chat?._id || authLoading || !user || authError || isStoppingSession) return;
    setIsStoppingSession(true);
    try {
      const token = localStorage.getItem("accessToken") || user.token;
      const response = await axios.post(
        `${import.meta.env.VITE_BASE_URL}/api/stop-session/${chat._id}`,
        {},
        { withCredentials: true, headers: { Authorization: `Bearer ${token}` } }
      );
      setIsFreePeriod(false);
      setTimerDuration(0);
      setTimerActive(false);
      setCredits(response.data.credits);
      setFreeSessionUsed(true);
      setActivePaidSession(null);
      setModalState("showFeedbackModal", true);
      setError(null);
      await fetchSessionStatus(); // Sync state after stopping
      toast.success("Paid session stopped successfully!");
    } catch (error) {
      setError(`Failed to stop session: ${error.response?.data?.error || error.message}`);
      toast.error(error.response?.data?.error || "Failed to stop session. Please try again.");
    } finally {
      setIsStoppingSession(false);
    }
  }, 500);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat?.messages]);

  // Initialize session on mount
  useEffect(() => {
    if (chat?._id && user && !authLoading && !authError) {
      if (activePaidSession && activePaidSession.psychicId !== chat._id) {
        setTimerActive(false);
        setTimerDuration(0);
        setIsFreePeriod(false);
        setError("End your current paid session to chat with this psychic.");
      } else {
        fetchSessionStatus();
      }
    } else {
      setError(authError || "Missing psychic ID or user authentication");
    }
  }, [chat?._id, user, authLoading, authError, activePaidSession]);

  // Handle emoji selection
  const handleEmojiClick = (emojiObject) => {
    setMessageInput((prev) => prev + emojiObject.emoji);
    setShowEmojiPicker(false);
  };

  // Send message
  const handleSendMessage = async () => {
    if (!messageInput.trim() || isSending || authLoading || !chat?._id || authError) {
      toast.error("Cannot send message. Please check your session or authentication.");
      return;
    }

    // Check if there is an active paid session with another psychic
    if (activePaidSession && activePaidSession.psychicId !== chat._id) {
      toast.error("End your current paid session to chat with this psychic.");
      return;
    }

    // Allow sending messages if timer is active (free or paid session)
    if (!timerActive) {
      if (freeSessionUsed && (credits == null || credits <= 0)) {
        toast.error("Out of credits. Please buy more to start a paid session.");
        return;
      }
      if (freeSessionUsed && credits > 0) {
        toast.error("Start a paid session to continue chatting.");
        return;
      }
      toast.error("Session not active. Please start a session.");
      return;
    }

    setIsSending(true);
    try {
      const token = localStorage.getItem("accessToken") || user.token;
      await onSendMessage(messageInput, token);
      setMessageInput("");
      setError(null);
    } catch (error) {
      setError(`Failed to send message: ${error.response?.data?.error || error.message}`);
      toast.error(error.response?.data?.error || "Failed to send message.");
    } finally {
      setIsSending(false);
    }
  };

  // Handle Enter key for sending message
  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Determine input placeholder
  const getInputPlaceholder = () => {
    if (!chat?._id || authLoading || authError) return "Loading...";
    if (activePaidSession && activePaidSession.psychicId !== chat._id) {
      return "End your current paid session to chat with this psychic";
    }
    if (timerActive) {
      return isFreePeriod ? "Type a message (free session)..." : "Type a message (paid session)...";
    }
    if (freeSessionUsed) {
      return credits > 0 ? "Start a paid session to chat" : "Purchase credits to continue chatting.";
    }
    return "Type a message...";
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border bg-[#EEEEEE] p-4">
       
          
         <Link to="/">
  <Button variant="ghost" size="icon" className="mr-1">
    <ArrowLeft className="h-5 w-5" />
  </Button>
</Link>

        
        {chat?._id ? (
          <>
            <Avatar className="h-10 w-10">
              <AvatarImage src={chat?.image || "/placeholder.svg"} alt={chat?.name} />
              <AvatarFallback>{chat?.name?.substring(0, 2)}</AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h2 className="font-medium">{chat?.name}</h2>
                <span className="text-xs text-muted-foreground">{chat?.type} Specialist</span>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1">
            <span className="text-sm text-muted-foreground">Loading psychic data...</span>
          </div>
        )}
        {(error || authError) && (
          <span className="text-xs text-red-500">{error || authError}</span>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-4">
          {(chat?.messages || []).map((message) => (
            <MessageBubble
              key={message._id || message.id}
              message={message}
              isMe={message.role === "user"}
              isLoading={message.isLoading}
            />
          ))}
          {isSending && (
            <div className="flex justify-start">
              <div className="max-w-[75%] rounded-lg bg-muted px-4 py-2">
                <div className="flex space-x-1">
                  <p className="text-muted-foreground">Typing</p>
                  <div className="flex items-center space-x-1">
                    <div className="w-2 h-2 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "0ms" }} />
                    <div className="w-2 h-2 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "150ms" }} />
                    <div className="w-2 h-2 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Timer, Credits, and Session Control Buttons */}
      {chat?._id && !authError && (
        <div className="border-t border-border bg-[#EEEEEE] p-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            {/* Timer on the Left */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1">
                    <Timer className="h-4 w-4 text-[#3B5EB7]" />
                    <span className="text-sm font-medium">
                      {timerActive
                        ? isFreePeriod
                          ? `Free Session: ${formatTimerDuration(timerDuration)}`
                          : `Paid Session: ${formatTimerDuration(timerDuration)}`
                        : activePaidSession && activePaidSession.psychicId !== chat._id
                        ? `Paid session active with another psychic`
                        : freeSessionUsed
                        ? "Free minute used"
                        : "Waiting to start free minute"}
                    </span>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  {isFreePeriod
                    ? "Free minute timer (1 minute, cannot be stopped)"
                    : timerActive
                    ? `Paid session: ${credits} credits remaining`
                    : activePaidSession && activePaidSession.psychicId !== chat._id
                    ? `End your paid session with another psychic to chat`
                    : freeSessionUsed
                    ? "Free minute used, start a paid session"
                    : "Free minute will start automatically"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {/* Credits and Session Buttons on the Right */}
            <div className="flex items-center gap-2 flex-wrap">
              {credits !== null && (
                <Button
                  variant="outline"
                  size="sm"
                  className="bg-[#3B5EB7] text-white hover:bg-[#2A4A9A] hover:text-white transition-colors"
                  disabled
                >
                  Credits: {credits}
                </Button>
              )}
              {!isFreePeriod && !timerActive && !activePaidSession && credits !== null && credits > 0 && freeSessionUsed && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={startPaidSession}
                        disabled={credits === null || authLoading || authError || !user || isStartingSession}
                        className="gap-1 bg-[#3B5EB7] text-white hover:bg-[#2A4A9A] hover:text-white transition-colors"
                      >
                        {isStartingSession ? "Starting..." : "Start Paid Session"}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      Start paid session (1 credit/min)
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              {timerActive && !isFreePeriod && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={stopPaidSession}
                        disabled={authLoading || authError || !user || isStoppingSession}
                        className="gap-1 bg-[#3B5EB7] text-white hover:bg-[#2A4A9A] hover:text-white transition-colors"
                      >
                        <StopCircle className="h-4 w-4" />
                        {isStoppingSession ? "Stopping..." : "Stop Paid Session"}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      Stop paid session
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              {!isFreePeriod && !timerActive && credits !== null && credits <= 0 && freeSessionUsed && (
                <span className="text-xs text-red-500">Purchase credits to continue</span>
              )}
              {activePaidSession && activePaidSession.psychicId !== chat._id && (
                <span className="text-xs text-red-500">Active session with another psychic</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Message Input */}
      <div className="border-t border-border p-4">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Input
              value={messageInput}
              onChange={(e) => setMessageInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={getInputPlaceholder()}
              className="pr-12"
              disabled={isSending || !chat?._id || authLoading || authError || (activePaidSession && activePaidSession.psychicId !== chat._id) || (!timerActive && freeSessionUsed && (credits == null || credits <= 0))}
            />
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-0 top-0"
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              aria-label="Toggle emoji picker"
              disabled={isSending || !chat?._id || authLoading || authError || (activePaidSession && activePaidSession.psychicId !== chat._id) || (!timerActive && freeSessionUsed && (credits == null || credits <= 0))}
            >
              <Smile className="h-5 w-5" />
            </Button>
            {showEmojiPicker && (
              <div ref={emojiPickerRef} className="absolute bottom-12 left-0 right-0 mx-auto w-[90%] max-w-md z-20 shadow-lg">
                <EmojiPicker
                  onEmojiClick={handleEmojiClick}
                  width="100%"
                  height={400}
                  emojiStyle="native"
                  autoFocusSearch={false}
                  previewConfig={{ showPreview: false }}
                  skinTonesDisabled={true}
                  categories={[
                    "smileys_people",
                    "animals_nature",
                    "food_drink",
                    "activities",
                    "travel_places",
                    "objects",
                    "symbols",
                    "flags",
                  ]}
                />
              </div>
            )}
          </div>
          <Button
            variant="brand"
            onClick={handleSendMessage}
            disabled={!messageInput.trim() || isSending || !chat?._id || authLoading || authError || (activePaidSession && activePaidSession.psychicId !== chat._id) || (!timerActive && freeSessionUsed && (credits == null || credits <= 0))}
            size="icon"
            aria-label="Send message"
          >
            <Send className="h-5 w-5" />
          </Button>
        </div>
      </div>

      <FeedbackModal
        open={showFeedbackModal}
        onClose={() => setModalState("showFeedbackModal", false)}
        psychicId={chat?._id}
        onSubmit={() => {
          console.log("Feedback submitted in ChatDetail");
        }}
      />
    </div>
  );
}