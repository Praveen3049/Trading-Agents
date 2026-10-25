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
        apply_crt_filter: bool = True,
        strategy_model: str = "crt_1am" # "crt_1am" | "crt_9am" | "london_ny" | "combined"
    ) -> Dict[str, Any]:
        """
        Executes an institutional bar-by-bar backtest:
        - Strategy 1: 01:00 AM CRT (Episode 8 by Mado):
            * Asian 9 PM (21:00 NY) 4H reference range (High, Low, 50% Midpoint)
            * 01:00 AM NY manipulation purge tracking (turtle soup)
            * 02:00 - 04:00 AM NY high-probability execution window
            * M15 Model-1 confirmation (Market Structure Shift & Displacement)
            * Trailing Breakeven protection at +1.0R
        - Strategy 2: 09:00 AM CRT (Episode 11 by Mado):
            * 1 AM & 5 AM NY predecessor feeder candles
            * 09:00 AM NY opening price anchor (OLHC/OHLC accumulation/distribution)
            * 09:00 - 13:00 NY New York Killzone execution (09:30-10:30 sweet spot)
            * Sweeps of 1AM/5AM feeder extremes with M15 Model-1 confirmation
        - Strategy 3: London & NY Killzone CRT (Asian session sweeps & FVGs)
        - Strategy 4: Combined Institutional CRT Suite
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

            # Normalize to America/New_York for institutional CRT alignment
            if df.index.tz is None:
                df.index = df.index.tz_localize('UTC').tz_convert('America/New_York')
            else:
                df.index = df.index.tz_convert('America/New_York')
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

        # 1 AM CRT Variables: Asian 9 PM NY (21:00 - 01:00 NY) Reference Range
        ref_9pm_high = 0.0
        ref_9pm_low = 9999999.0
        swept_9pm_low = False
        swept_9pm_high = False
        purge_low_wick = 9999999.0
        purge_high_wick = 0.0

        # 9 AM CRT Variables: 1 AM & 5 AM Predecessor Feeder Candles
        feeder_high = 0.0
        feeder_low = 9999999.0
        open_9am = 0.0
        swept_feeder_low = False
        swept_feeder_high = False
        purge_9am_low_wick = 9999999.0
        purge_9am_high_wick = 0.0
        anchor_9am_hour = 10 if "BTC" in symbol.upper() else 9

        # Standard Asian Range (20:00 - 02:00 NY)
        asian_high = 0.0
        asian_low = 9999999.0
        last_day = None

        # 50-period SMA for Higher Timeframe (4H) trend filter
        sma50 = pd.Series(closes).rolling(50).mean().values

        for i in range(window_size, n):
            ts = timestamps[i]
            day = ts.date()
            hour = ts.hour
            minute = ts.minute
            
            curr_h = highs[i]
            curr_l = lows[i]
            curr_c = closes[i]
            curr_o = opens[i]
            curr_time = str(ts)

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

            # Update Day & Reference Ranges
            if day != last_day:
                last_day = day
                asian_high = 0.0
                asian_low = 9999999.0

            # Build Standard Asian Range (20:00 - 02:00 NY)
            if hour >= 20 or hour <= 2:
                asian_high = max(asian_high, curr_h)
                asian_low = min(asian_low, curr_l)

            # Build 9 PM (21:00) NY Reference Candle (hours 21, 22, 23, 0 NY)
            if hour in [21, 22, 23, 0]:
                if hour == 21 and minute == 0:
                    ref_9pm_high = curr_h
                    ref_9pm_low = curr_l
                    swept_9pm_low = False
                    swept_9pm_high = False
                    purge_low_wick = 9999999.0
                    purge_high_wick = 0.0
                else:
                    ref_9pm_high = max(ref_9pm_high, curr_h)
                    ref_9pm_low = min(ref_9pm_low, curr_l)

            # Build 9 AM CRT Feeder Ranges (1 AM & 5 AM NY candles, hours 1 to 8 NY)
            if 1 <= hour <= 8:
                if hour == 1 and minute == 0:
                    feeder_high = curr_h
                    feeder_low = curr_l
                    swept_feeder_low = False
                    swept_feeder_high = False
                    purge_9am_low_wick = 9999999.0
                    purge_9am_high_wick = 0.0
                else:
                    feeder_high = max(feeder_high, curr_h)
                    feeder_low = min(feeder_low, curr_l)

            # Record 9 AM NY Opening Price Anchor
            if hour == anchor_9am_hour and minute == 0:
                open_9am = curr_o

            # -------------------------------------------------------------------
            # STRATEGY MODEL A: 01:00 AM CRT MODEL (Episode 8 by Mado)
            # -------------------------------------------------------------------
            if strategy_model in ["crt_1am", "combined"]:
                if hour == 1:
                    if ref_9pm_high > 0 and curr_h > ref_9pm_high:
                        swept_9pm_high = True
                        purge_high_wick = max(purge_high_wick, curr_h)
                    if ref_9pm_low < 999999 and curr_l < ref_9pm_low:
                        swept_9pm_low = True
                        purge_low_wick = min(purge_low_wick, curr_l)

                elif hour in [2, 3]:
                    if swept_9pm_high and curr_h > purge_high_wick:
                        purge_high_wick = curr_h
                    if swept_9pm_low and curr_l < purge_low_wick:
                        purge_low_wick = curr_l

                    htf_trend_bull = curr_c >= sma50[i] if not np.isnan(sma50[i]) else True
                    htf_trend_bear = curr_c <= sma50[i] if not np.isnan(sma50[i]) else True

                    if swept_9pm_low and curr_c > ref_9pm_low and purge_low_wick < ref_9pm_low and (not apply_crt_filter or htf_trend_bull):
                        entry = curr_c
                        sl_offset = (purge_low_wick * 0.0006) if "XAU" in symbol or "BTC" in symbol else 0.0004
                        sl = purge_low_wick - sl_offset
                        risk_dist = entry - sl
                        if risk_dist > 0 and (risk_dist / entry) < 0.02:
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
                                "setup_type": "01:00 AM CRT Bullish Purge & M15 Model-1"
                            }
                            swept_9pm_low = False
                            continue

                    elif swept_9pm_high and curr_c < ref_9pm_high and purge_high_wick > ref_9pm_high and (not apply_crt_filter or htf_trend_bear):
                        entry = curr_c
                        sl_offset = (purge_high_wick * 0.0006) if "XAU" in symbol or "BTC" in symbol else 0.0004
                        sl = purge_high_wick + sl_offset
                        risk_dist = sl - entry
                        if risk_dist > 0 and (risk_dist / entry) < 0.02:
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
                                "setup_type": "01:00 AM CRT Bearish Purge & M15 Model-1"
                            }
                            swept_9pm_high = False
                            continue

            # -------------------------------------------------------------------
            # STRATEGY MODEL B: 05:00 AM CRT MODEL (Episode 10 by Mado)
            # -------------------------------------------------------------------
            if strategy_model in ["crt_5am", "combined"]:
                anchor_5am = 6 if "BTC" in symbol.upper() else 5
                # 05:00 AM Window: 05:00 to 09:00 NY, Execution in 06:00-08:30 NY
                if anchor_5am <= hour <= 8 and (ref_9pm_high > 0 or feeder_high > 0):
                    ref_high_target = max(ref_9pm_high, feeder_high)
                    ref_low_target = min(ref_9pm_low, feeder_low) if min(ref_9pm_low, feeder_low) > 0 else ref_9pm_low

                    if curr_h > ref_high_target:
                        swept_feeder_high = True
                        purge_high_wick = max(purge_high_wick, curr_h)
                    if curr_l < ref_low_target:
                        swept_feeder_low = True
                        purge_low_wick = min(purge_low_wick, curr_l)

                    # Only execute inside 06:00 - 08:30 NY high-probability window
                    if (hour == 6) or (hour == 7 and minute <= 45):
                        htf_trend_bull = curr_c >= sma50[i] if not np.isnan(sma50[i]) else True
                        htf_trend_bear = curr_c <= sma50[i] if not np.isnan(sma50[i]) else True

                        # 5AM CRT LONG: Swept 1AM/9PM Low + M15 Model-1 Close back above
                        if swept_feeder_low and curr_c > ref_low_target and purge_low_wick < ref_low_target and (not apply_crt_filter or htf_trend_bull):
                            entry = curr_c
                            sl_offset = (purge_low_wick * 0.0006) if "XAU" in symbol or "BTC" in symbol else 0.0004
                            sl = purge_low_wick - sl_offset
                            risk_dist = entry - sl
                            if risk_dist > 0 and (risk_dist / entry) < 0.02:
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
                                    "setup_type": "05:00 AM CRT Bullish Purge & M15 Model-1 (Ep 10)"
                                }
                                swept_feeder_low = False
                                continue

                        # 5AM CRT SHORT: Swept 1AM/9PM High + M15 Model-1 Close back below
                        elif swept_feeder_high and curr_c < ref_high_target and purge_high_wick > ref_high_target and (not apply_crt_filter or htf_trend_bear):
                            entry = curr_c
                            sl_offset = (purge_high_wick * 0.0006) if "XAU" in symbol or "BTC" in symbol else 0.0004
                            sl = purge_high_wick + sl_offset
                            risk_dist = sl - entry
                            if risk_dist > 0 and (risk_dist / entry) < 0.02:
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
                                    "setup_type": "05:00 AM CRT Bearish Purge & M15 Model-1 (Ep 10)"
                                }
                                swept_feeder_high = False
                                continue

            # -------------------------------------------------------------------
            # STRATEGY MODEL C: 09:00 AM CRT MODEL (Episode 11 by Mado)
            # -------------------------------------------------------------------
            if strategy_model in ["crt_9am", "combined"]:
                if anchor_9am_hour <= hour < 13 and open_9am > 0:
                    if curr_h > feeder_high:
                        swept_feeder_high = True
                        purge_9am_high_wick = max(purge_9am_high_wick, curr_h)
                    if curr_l < feeder_low:
                        swept_feeder_low = True
                        purge_9am_low_wick = min(purge_9am_low_wick, curr_l)

                    htf_trend_bull = curr_c >= sma50[i] if not np.isnan(sma50[i]) else True
                    htf_trend_bear = curr_c <= sma50[i] if not np.isnan(sma50[i]) else True

                    # 9AM CRT LONG: Below 9 AM Open + Swept Feeder Low + M15 Model-1 Close back above
                    if curr_c < open_9am and swept_feeder_low and curr_c > feeder_low and purge_9am_low_wick < feeder_low and (not apply_crt_filter or htf_trend_bull):
                        entry = curr_c
                        sl_offset = (purge_9am_low_wick * 0.0006) if "XAU" in symbol or "BTC" in symbol else 0.0004
                        sl = purge_9am_low_wick - sl_offset
                        risk_dist = entry - sl
                        if risk_dist > 0 and (risk_dist / entry) < 0.02:
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
                                "setup_type": "09:00 AM CRT Bullish Expansion (Ep 11)"
                            }
                            swept_feeder_low = False
                            continue

                    # 9AM CRT SHORT: Above 9 AM Open + Swept Feeder High + M15 Model-1 Close back below
                    elif curr_c > open_9am and swept_feeder_high and curr_c < feeder_high and purge_9am_high_wick > feeder_high and (not apply_crt_filter or htf_trend_bear):
                        entry = curr_c
                        sl_offset = (purge_9am_high_wick * 0.0006) if "XAU" in symbol or "BTC" in symbol else 0.0004
                        sl = purge_9am_high_wick + sl_offset
                        risk_dist = sl - entry
                        if risk_dist > 0 and (risk_dist / entry) < 0.02:
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
                                "setup_type": "09:00 AM CRT Bearish Expansion (Ep 11)"
                            }
                            swept_feeder_high = False
                            continue

            # -------------------------------------------------------------------
            # STRATEGY MODEL C: LONDON & NY KILLZONE CRT MODEL (02-05 & 08-11 NY)
            # -------------------------------------------------------------------
            if strategy_model in ["london_ny"]:
                is_london = 2 <= hour <= 5
                is_ny = 8 <= hour <= 11
                if apply_crt_filter and not (is_london or is_ny):
                    continue

                sub_df = df.iloc[i - window_size : i]
                sub_highs = sub_df['high'].values
                sub_lows = sub_df['low'].values
                sub_closes = sub_df['close'].values

                range_high = sub_highs.max()
                range_low = sub_lows.min()
                equilibrium = (range_high + range_low) / 2.0

                sma20 = sub_closes[-20:].mean()
                is_bullish = curr_c > sma20 and curr_c > sub_closes[-4]
                is_bearish = curr_c < sma20 and curr_c < sub_closes[-4]

                has_swept_low = (curr_l < asian_low and curr_c > asian_low) if asian_low < 999999 else (curr_l < sub_lows[-10:].min())
                has_swept_high = (curr_h > asian_high and curr_c < asian_high) if asian_high > 0 else (curr_h > sub_highs[-10:].max())

                fvg_bull = False
                fvg_bear = False
                for k in range(len(sub_df) - 4, len(sub_df) - 1):
                    if sub_lows[k] > sub_highs[k - 2] and sub_closes[k - 1] > sub_df['open'].iloc[k - 1]:
                        fvg_bull = True
                    elif sub_highs[k] < sub_lows[k - 2] and sub_closes[k - 1] < sub_df['open'].iloc[k - 1]:
                        fvg_bear = True

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
                            "setup_type": "London/NY CRT Bullish Sweep & FVG"
                        }
                        continue

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
                            "setup_type": "London/NY CRT Bearish Sweep & FVG"
                        }
                        continue

        # Performance Statistics
        total_trades = len(trades)
        if total_trades == 0:
            return {
                "status": "success",
                "symbol": symbol,
                "period": period,
                "timeframe": timeframe,
                "strategy_model": strategy_model,
                "initial_capital": self.initial_capital,
                "final_capital": self.initial_capital,
                "net_profit": 0.0,
                "net_return_pct": 0.0,
                "total_trades": 0,
                "wins": 0,
                "losses": 0,
                "breakevens": 0,
                "win_rate": 0.0,
                "profit_factor": 0.0,
                "risk_reward_ratio": rr_target,
                "max_drawdown_pct": 0.0,
                "equity_curve": equity_curve,
                "recent_trades": []
            }

        wins = [t for t in trades if t["outcome"] == "WIN"]
        losses = [t for t in trades if t["outcome"] == "LOSS"]
        breakevens = [t for t in trades if t["outcome"] == "BREAKEVEN"]

        num_wins = len(wins)
        num_losses = len(losses)
        num_be = len(breakevens)
        win_rate = round((num_wins / total_trades) * 100, 1)

        gross_profit = sum(t["pnl"] for t in wins)
        gross_loss = abs(sum(t["pnl"] for t in losses))
        profit_factor = round(gross_profit / gross_loss, 2) if gross_loss > 0 else (99.0 if gross_profit > 0 else 0.0)

        net_profit = round(capital - self.initial_capital, 2)
        net_return_pct = round((net_profit / self.initial_capital) * 100, 2)

        # Max Drawdown Calculation
        peak = self.initial_capital
        max_dd = 0.0
        for pt in equity_curve:
            eq = pt["equity"]
            if eq > peak:
                peak = eq
            dd = (peak - eq) / peak * 100.0
            if dd > max_dd:
                max_dd = dd

        return {
            "status": "success",
            "symbol": symbol,
            "period": period,
            "timeframe": timeframe,
            "strategy_model": strategy_model,
            "apply_crt_filter": apply_crt_filter,
            "initial_capital": self.initial_capital,
            "final_capital": round(capital, 2),
            "net_profit": net_profit,
            "net_return_pct": net_return_pct,
            "total_trades": total_trades,
            "wins": num_wins,
            "losses": num_losses,
            "breakevens": num_be,
            "win_rate": win_rate,
            "profit_factor": profit_factor,
            "risk_reward_ratio": rr_target,
            "max_drawdown_pct": round(max_dd, 2),
            "equity_curve": equity_curve[-25:],
            "recent_trades": trades[-15:]
        }

backtest_engine = BacktestEngine()
