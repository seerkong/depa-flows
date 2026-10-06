export interface OrderInput { iterations?: number; iteration?: number; count?: number }
export interface OrderResult extends OrderInput { lastAction?: string; outcome?: string }
