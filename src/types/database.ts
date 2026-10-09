export type Channel = "whatsapp" | "instagram" | "messenger";
export type ConversationStatus = "open" | "closed" | "pending";
export type SenderType = "user" | "contact" | "ai";
/**
 * Las etapas del embudo son datos editables, no un tipo cerrado. Lo único fijo
 * es qué significa cada una para las métricas: abierta, ganada o perdida.
 */
export type StageKind = "open" | "won" | "lost";
export type AppointmentStatus = "scheduled" | "completed" | "cancelled";

export interface Contact {
  id: string;
  workspace_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  avatar_url: string | null;
  tags: string[];
  notes: Record<string, unknown>;
  bot_enabled: boolean;
  created_at: string;
}
