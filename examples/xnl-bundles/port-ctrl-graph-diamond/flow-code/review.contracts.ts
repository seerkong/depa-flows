export interface OrderInput {count?:number;order?:string;accepted?:boolean;a?:boolean;b?:boolean;c?:boolean}
export interface OrderResult extends OrderInput {lastAction?:string}
