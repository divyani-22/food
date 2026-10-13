import DashboardLayout from "@/components/DashboardLayout";
import { AIChatBox } from "@/components/AIChatBox";
import { trpc } from "@/lib/trpc";
import { useState, useEffect } from "react";
import { useLocation } from "wouter";

export default function Chat() {
  // wouter's location excludes the query string, so read it from window.location
  useLocation();
  const scanIdParam = new URLSearchParams(window.location.search).get("scanId");
  const parsedScanId = scanIdParam ? parseInt(scanIdParam, 10) : NaN;
  const scanId = Number.isFinite(parsedScanId) ? parsedScanId : undefined;

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
          isLoading={sendMessageMutation.isPending}
          height="100%"
          placeholder="Ask me about food ingredients, health impacts, or safer alternatives..."
        />
      </div>
    </DashboardLayout>
  );
}
