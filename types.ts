// Money = integer cents. Price = integer 1/10,000 USD ("price4"). No floats in balances.
export type Cents = number;
export type Price4 = number;

export interface EntryRule {
  trigger: 'price_at' | 'above' | 'below';
  price4: Price4;
  rsiBelow?: number;          // optional extra condition, needs tick.indicators.rsi
  priceAboveSma?: boolean;    // optional extra condition, needs tick.indicators.sma
}
export interface ExitRule {
  takeProfitBps?: number;     // 500 = 5%
  stopLossBps?: number;
  trailingStopBps?: number;
  maxHoldMs?: number;
}
export interface BotConfig {
  id: string;
  symbol: string;
  budgetCents: Cents;         // virtual USD per position
  entry: EntryRule;
  exit: ExitRule;
  feeBps: number;
  feeMinCents: Cents;
  slippageBps: number;
  maxOpenPositions: number;
  maxTotalTrades?: number;
  window?: { fromMs: number; toMs: number };
  maxStaleMs: number;         // data older than this pauses the bot
}
export interface Tick {
  symbol: string;
  price4: Price4;
  ts: number;                 // ms epoch of the quote
  size?: number;              // trade size (shares), when the feed provides it
  indicators?: { rsi?: number; sma?: Price4 };
}
export interface Position {
  id: string; entryTs: number; entryPrice4: Price4; qty: number;
  costCents: Cents; entryFeeCents: Cents; highWater4: Price4;
}
export type ExitReason = 'TAKE_PROFIT' | 'STOP_LOSS' | 'TRAILING_STOP' | 'TIME_EXIT' | 'MANUAL';
export interface ClosedTrade {
  id: string; entryTs: number; exitTs: number; qty: number;
  entryPrice4: Price4; exitPrice4: Price4; reason: ExitReason;
  netPnlCents: Cents; feesCents: Cents;
}
export type EventType =
  | 'BOT_STARTED' | 'BOT_STOPPED' | 'ENTRY_CONDITION_MET' | 'POSITION_OPENED'
  | 'ENTRY_SKIPPED' | 'POSITION_CLOSED' | 'DATA_STALE' | 'DATA_DISCONNECTED' | 'DATA_RECONNECTED';
export interface BotEvent { ts: number; type: EventType; price4?: Price4; message: string; }
export interface BotState {
  mode: 'PAPER';              // the only legal value; engine throws otherwise
  status: 'running' | 'paused' | 'stopped';
  openingCashCents: Cents; cashCents: Cents;
  positions: Position[]; closed: ClosedTrade[]; events: BotEvent[];
  lastTickTs: number; lastPrice4?: Price4; prevCond?: boolean; tradeSeq: number;
}
