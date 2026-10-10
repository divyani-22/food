import DashboardLayout from "@/components/DashboardLayout";
import { AIChatBox } from "@/components/AIChatBox";
import { trpc } from "@/lib/trpc";
import { useState, useEffect } from "react";
import { useLocation } from "wouter";

export default function Chat() {
  const [location] = useLocation();
  const searchParams = new URLSearchParams(location.split("?")[1]);
  const scanIdParam = searchParams.get("scanId");
  const scanId = scanIdParam ? parseInt(scanIdParam) : undefined;

  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const { data: history, refetch } = trpc.chat.getHistory.useQuery({ scanId });
  const sendMessageMutation = trpc.chat.sendMessage.useMutation();

  useEffect(() => {
    if (history) {
      setMessages(history.map(h => ({ role: h.role as "user" | "assistant", content: h.content })));
    }
  }, [history]);

  const handleSendMessage = async (message: string) => {
    setMessages(prev => [...prev, { role: "user", content: message }]);
    try {
      const response = await sendMessageMutation.mutateAsync({ message, scanId });
      setMessages(prev => [...prev, { role: "assistant", content: response.message }]);
      refetch();
    } catch (error: any) {
      setMessages(prev => [...prev, { role: "assistant", content: `Error: ${error.message || "Failed to get response"}` }]);
    }
  };

  return (
    <DashboardLayout>
      <div className="h-[calc(100vh-8rem)]">
        <AIChatBox
          messages={messages}
          onSendMessage={handleSendMessage}
          placeholder="Ask me about food ingredients, health impacts, or safer alternatives..."
        />
      </div>
    </DashboardLayout>
  );
}
