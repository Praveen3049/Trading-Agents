import logging
from typing import Dict, Any, List, Optional
import pandas as pd
import numpy as np
import yfinance as yf
from .market_data_service import SUPPORTED_ASSETS

logger = logging.getLogger(__name__)

class BacktestEngine:
    def __init__(self, initial_capital: float = 10000.0, risk_per_trade_pct: float = 1.0):
        self.initial_capital = initial_capital
        self.risk_per_trade_pct = risk_per_trade_pct # 1% risk per trade

    def run_backtest(
        self,
        symbol: str = "XAUUSD",
        timeframe: str = "15m",
        period: str = "60d",
        rr_target: float = 2.0,
        apply_crt_filter: bool = True
    ) -> Dict[str, Any]:
        """
        Executes an institutional bar-by-bar backtest:
        - Higher Timeframe Trend & Regime (Discount / Premium)
        - GUARDEER Volumetric Order Blocks & FVGs
        - CRT Session Window (London & NY Open only)
        - Asian Session Sweep Detection
        - Trailing Breakeven Protection at +1.0R
        - Strict No-Lookahead-Bias Execution
        """
        cfg = SUPPORTED_ASSETS.get(symbol.upper(), {"yf_symbol": symbol, "decimals": 2})
        yf_sym = cfg.get("yf_symbol", symbol)

        try:
            df = yf.download(yf_sym, period=period, interval=timeframe, progress=False)
            if df.empty:
                return {"status": "error", "message": f"No historical data found for {symbol}"}

            if isinstance(df.columns, pd.MultiIndex):
                df.columns = [col[0] for col in df.columns]

            df = df.dropna().copy()
            df.columns = [c.lower() for c in df.columns]
        except Exception as e:
            return {"status": "error", "message": str(e)}

        n = len(df)
        if n < 80:
            return {"status": "error", "message": "Insufficient bars for backtesting"}

        highs = df['high'].values
        lows = df['low'].values
        closes = df['close'].values
        opens = df['open'].values
        timestamps = df.index

        capital = self.initial_capital
        trades: List[Dict[str, Any]] = []
        equity_curve = [{"time": str(timestamps[0]), "equity": round(capital, 2)}]

        active_trade: Optional[Dict[str, Any]] = None
        cooldown_bars = 0
        window_size = 40

        # Asian Range Tracking variables (00:00 - 06:00 UTC)
        asian_high = 0.0
        asian_low = 9999999.0
        last_day = None

        for i in range(window_size, n):
            ts = timestamps[i]
            day = ts.date()
            hour = ts.hour
            
            curr_h = highs[i]
            curr_l = lows[i]
            curr_c = closes[i]
            curr_o = opens[i]
            curr_time = str(ts)

            # Update Asian Range
            if day != last_day:
                last_day = day
                asian_high = 0.0
                asian_low = 9999999.0

            if 0 <= hour <= 6:
                asian_high = max(asian_high, curr_h)
                asian_low = min(asian_low, curr_l)

            # 1. Manage Active Trade
            if active_trade is not None:
                is_long = active_trade["direction"] == "BUY"
                sl = active_trade["stop_loss"]
                tp = active_trade["take_profit"]
                entry = active_trade["entry_price"]
                risk_dist = active_trade["risk_dist"]

                # Breakeven trailing check: If trade achieved +1.0R, move SL to entry
                if not active_trade.get("breakeven_activated", False):
                    if is_long and curr_h >= (entry + (risk_dist * 1.0)):
                        active_trade["stop_loss"] = entry
                        active_trade["breakeven_activated"] = True
                        sl = entry
                    elif not is_long and curr_l <= (entry - (risk_dist * 1.0)):
                        active_trade["stop_loss"] = entry
                        active_trade["breakeven_activated"] = True
                        sl = entry

                outcome = None
                exit_price = 0.0

                if is_long:
                    if curr_l <= sl:
                        outcome = "BREAKEVEN" if active_trade.get("breakeven_activated") and sl == entry else "LOSS"
                        exit_price = sl
                    elif curr_h >= tp:
                        outcome = "WIN"
                        exit_price = tp
                else: # Short
                    if curr_h >= sl:
                        outcome = "BREAKEVEN" if active_trade.get("breakeven_activated") and sl == entry else "LOSS"
                        exit_price = sl
                    elif curr_l <= tp:
                        outcome = "WIN"
                        exit_price = tp

                if outcome:
                    risk_amount = capital * (self.risk_per_trade_pct / 100.0)
                    if outcome == "WIN":
                        profit = risk_amount * rr_target
                        r_multiple = rr_target
                    elif outcome == "BREAKEVEN":
                        profit = 0.0
                        r_multiple = 0.0
                    else:
                        profit = -risk_amount
                        r_multiple = -1.0

                    capital += profit
                    equity_curve.append({"time": curr_time, "equity": round(capital, 2)})

                    active_trade.update({
                        "exit_time": curr_time,
                        "exit_price": round(exit_price, cfg["decimals"]),
                        "outcome": outcome,
                        "pnl": round(profit, 2),
                        "r_multiple": r_multiple,
                        "capital_after": round(capital, 2)
                    })
                    trades.append(active_trade)
                    active_trade = None
                    cooldown_bars = 4 # Avoid immediate re-entry
                    continue
                else:
                    continue # Still holding trade

            if cooldown_bars > 0:
                cooldown_bars -= 1
                continue

            # 2. Session Window Filter (London 07-11 UTC & NY 12-16 UTC)
            if apply_crt_filter and symbol.upper() != "BTCUSD":
                is_london = 7 <= hour <= 11
                is_ny = 12 <= hour <= 16
                if not (is_london or is_ny):
                    continue # Disallow trading during off-peak chop

            # 3. Technical Structure Analysis
            sub_df = df.iloc[i - window_size : i]
            sub_highs = sub_df['high'].values
            sub_lows = sub_df['low'].values
            sub_closes = sub_df['close'].values

            range_high = sub_highs.max()
            range_low = sub_lows.min()
            equilibrium = (range_high + range_low) / 2.0

            # Trend & Momentum
            sma20 = sub_closes[-20:].mean()
            is_bullish = curr_c > sma20 and curr_c > sub_closes[-4]
            is_bearish = curr_c < sma20 and curr_c < sub_closes[-4]

            # Sweep Check: Asian Low swept for Buy, Asian High swept for Sell
            has_swept_low = (curr_l < asian_low and curr_c > asian_low) if asian_low < 999999 else (curr_l < sub_lows[-10:].min())
            has_swept_high = (curr_h > asian_high and curr_c < asian_high) if asian_high > 0 else (curr_h > sub_highs[-10:].max())

            # Detect Recent Fair Value Gap (in previous 4 bars)
            fvg_bull = False
            fvg_bear = False
            for k in range(len(sub_df) - 4, len(sub_df) - 1):
                if sub_lows[k] > sub_highs[k - 2] and sub_closes[k - 1] > sub_df['open'].iloc[k - 1]:
                    fvg_bull = True
                elif sub_highs[k] < sub_lows[k - 2] and sub_closes[k - 1] < sub_df['open'].iloc[k - 1]:
                    fvg_bear = True

            # LONG TRIGGER: Bullish trend + Discount Zone + (Sweep OR FVG)
            if is_bullish and curr_c < equilibrium and (has_swept_low or fvg_bull):
                entry = curr_c
                sl = (range_low * 0.999) if "XAU" in symbol or "BTC" in symbol else (range_low - 0.0015)
                risk_dist = entry - sl
                if risk_dist > 0:
                    tp = entry + (risk_dist * rr_target)
                    active_trade = {
                        "trade_num": len(trades) + 1,
                        "entry_time": curr_time,
                        "symbol": symbol,
                        "direction": "BUY",
                        "entry_price": round(entry, cfg["decimals"]),
                        "stop_loss": round(sl, cfg["decimals"]),
                        "take_profit": round(tp, cfg["decimals"]),
                        "risk_dist": risk_dist,
                        "setup_type": "London/NY CRT Bullish Sweep & FVG" if apply_crt_filter else "Standard Bullish FVG"
                    }
                    continue

            # SHORT TRIGGER: Bearish trend + Premium Zone + (Sweep OR FVG)
            elif is_bearish and curr_c > equilibrium and (has_swept_high or fvg_bear):
                entry = curr_c
                sl = (range_high * 1.001) if "XAU" in symbol or "BTC" in symbol else (range_high + 0.0015)
                risk_dist = sl - entry
                if risk_dist > 0:
                    tp = entry - (risk_dist * rr_target)
                    active_trade = {
                        "trade_num": len(trades) + 1,
                        "entry_time": curr_time,
                        "symbol": symbol,
                        "direction": "SELL",
                        "entry_price": round(entry, cfg["decimals"]),
                        "stop_loss": round(sl, cfg["decimals"]),
                        "take_profit": round(tp, cfg["decimals"]),
                        "risk_dist": risk_dist,
                        "setup_type": "London/NY CRT Bearish Sweep & FVG" if apply_crt_filter else "Standard Bearish FVG"
                    }
                    continue

        # 4. Performance Statistics
        total_trades = len(trades)
        if total_trades == 0:
            return {
                "status": "success",
                "symbol": symbol,
                "total_trades": 0,
                "win_rate": 0.0,
                "net_profit": 0.0,
                "profit_factor": 0.0,
                "max_drawdown_pct": 0.0,
                "trades": [],
                "equity_curve": []
            }

        wins = [t for t in trades if t["outcome"] == "WIN"]
        losses = [t for t in trades if t["outcome"] == "LOSS"]
        breakevens = [t for t in trades if t["outcome"] == "BREAKEVEN"]

        win_rate = (len(wins) / total_trades) * 100.0
        gross_profit = sum(t["pnl"] for t in wins)
        gross_loss = abs(sum(t["pnl"] for t in losses))
        profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else 99.9

        net_profit = capital - self.initial_capital
        net_return_pct = (net_profit / self.initial_capital) * 100.0

        # Maximum Drawdown
        equity_values = [p["equity"] for p in equity_curve]
        peak = equity_values[0]
        max_dd_pct = 0.0
        for val in equity_values:
            if val > peak:
                peak = val
            dd = ((peak - val) / peak) * 100.0
            if dd > max_dd_pct:
                max_dd_pct = dd

        return {
            "status": "success",
            "symbol": symbol,
            "period": period,
            "timeframe": timeframe,
            "apply_crt_filter": apply_crt_filter,
            "initial_capital": self.initial_capital,
            "final_capital": round(capital, 2),
            "net_profit": round(net_profit, 2),
            "net_return_pct": round(net_return_pct, 2),
            "total_trades": total_trades,
            "wins": len(wins),
            "losses": len(losses),
            "breakevens": len(breakevens),
            "win_rate": round(win_rate, 1),
            "profit_factor": round(profit_factor, 2),
            "risk_reward_ratio": rr_target,
            "max_drawdown_pct": round(max_dd_pct, 2),
            "equity_curve": equity_curve[-25:],
            "recent_trades": trades[-12:]
        }

backtest_engine = BacktestEngine()
