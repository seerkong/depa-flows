export interface OrderInput { route?: "A" | "B" | "C"; count?: number }
export interface OrderResult extends OrderInput { lastAction?: string; outcome?: string }
