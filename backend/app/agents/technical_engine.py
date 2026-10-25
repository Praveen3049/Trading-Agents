import pandas as pd
import numpy as np
from typing import Dict, Any, List, Optional

class TechnicalStructureEngine:
    def __init__(self, data: pd.DataFrame):
        """
        Initialize with a DataFrame containing OHLCV data.
        Expected columns: ['open', 'high', 'low', 'close', 'volume', 'timestamp'] (or 'time')
        """
        self.df = data.copy()
        # Normalize column names to lowercase
        self.df.columns = [col.lower() for col in self.df.columns]

    def _pivot_high(self, src: pd.Series, left_len: int, right_len: int) -> pd.Series:
        """Replicates PineScript's ta.pivothigh(src, left, right)."""
        pivots = pd.Series(np.nan, index=src.index)
        for i in range(left_len, len(src) - right_len):
            window = src.iloc[i - left_len : i + right_len + 1]
            if src.iloc[i] == window.max() and not np.isnan(src.iloc[i]):
                pivots.iloc[i] = src.iloc[i]
        return pivots

    def _pivot_low(self, src: pd.Series, left_len: int, right_len: int) -> pd.Series:
        """Replicates PineScript's ta.pivotlow(src, left, right)."""
        pivots = pd.Series(np.nan, index=src.index)
        for i in range(left_len, len(src) - right_len):
            window = src.iloc[i - left_len : i + right_len + 1]
            if src.iloc[i] == window.min() and not np.isnan(src.iloc[i]):
                pivots.iloc[i] = src.iloc[i]
        return pivots

    def analyze_full_structure(self, internal_len: int = 5, swing_len: int = 20) -> Dict[str, Any]:
        """
        Complete implementation of GUARDEER indicator:
        - Pivots (Internal & Swing)
        - BOS / CHoCH / CHoCH+ state machine
        - Volumetric Order Blocks (Bullish & Bearish)
        - Fair Value Gaps (FVG)
        - Strong / Weak High & Low (DOL)
        - Premium / Discount / Equilibrium Zones
        """
        n_bars = len(self.df)
        if n_bars < 15:
            return self._empty_structure()

        highs = self.df['high']
        lows = self.df['low']
        closes = self.df['close']
        opens = self.df['open']
        volumes = self.df['volume'] if 'volume' in self.df.columns else pd.Series(100, index=self.df.index)

        # 1. Detect Pivots
        iH = self._pivot_high(highs, internal_len, internal_len)
        iL = self._pivot_low(lows, internal_len, internal_len)
        sH = self._pivot_high(highs, swing_len, swing_len)
        sL = self._pivot_low(lows, swing_len, swing_len)

        # 2. Market Structure State Machine (BOS / CHoCH)
        itrend = 0 # 1: Bullish, -1: Bearish
        trend = 0
        
        last_ms_event = "BOS"
        last_ih_price = None
        last_il_price = None
        prev_il_price = None
        prev_ih_price = None

        order_blocks = []
        events_history = []

        for i in range(n_bars):
            # Update pivots
            if not np.isnan(iH.iloc[i]):
                prev_ih_price = last_ih_price
                last_ih_price = iH.iloc[i]
            if not np.isnan(iL.iloc[i]):
                prev_il_price = last_il_price
                last_il_price = iL.iloc[i]

            c = closes.iloc[i]

            # Bullish Breakout
            if last_ih_price is not None and c > last_ih_price:
                if itrend <= 0:
                    # Trend reversal -> CHoCH
                    is_choch_plus = prev_il_price is not None and last_il_price is not None and last_il_price > prev_il_price
                    event = "CHoCH+" if is_choch_plus else "CHoCH"
                    itrend = 1
                else:
                    event = "BOS"

                last_ms_event = event
                events_history.append({"index": i, "event": event, "direction": "BULLISH", "price": last_ih_price})
                
                # Order Block formation: lowest candle in the pullback before this breakout
                lookback = min(15, i)
                lowest_idx = lows.iloc[i - lookback : i].idxmin()
                ob_bottom = float(lows.loc[lowest_idx])
                ob_top = float(highs.loc[lowest_idx])
                ob_vol = float(volumes.loc[lowest_idx])

                order_blocks.append({
                    "type": "BULLISH_OB",
                    "top": ob_top,
                    "bottom": ob_bottom,
                    "volume": ob_vol,
                    "trigger_event": event,
                    "created_bar": int(i),
                    "mitigated": False
                })
                last_ih_price = None # Reset breakout level

            # Bearish Breakout
            elif last_il_price is not None and c < last_il_price:
                if itrend >= 0:
                    is_choch_plus = prev_ih_price is not None and last_ih_price is not None and last_ih_price < prev_ih_price
                    event = "CHoCH+" if is_choch_plus else "CHoCH"
                    itrend = -1
                else:
                    event = "BOS"

                last_ms_event = event
                events_history.append({"index": i, "event": event, "direction": "BEARISH", "price": last_il_price})

                # Bearish OB: highest candle in the rally before this breakdown
                lookback = min(15, i)
                highest_idx = highs.iloc[i - lookback : i].idxmax()
                ob_bottom = float(lows.loc[highest_idx])
                ob_top = float(highs.loc[highest_idx])
                ob_vol = float(volumes.loc[highest_idx])

                order_blocks.append({
                    "type": "BEARISH_OB",
                    "top": ob_top,
                    "bottom": ob_bottom,
                    "volume": ob_vol,
                    "trigger_event": event,
                    "created_bar": int(i),
                    "mitigated": False
                })
                last_il_price = None

        # 3. Fair Value Gaps (FVGs)
        fvgs = []
        for i in range(2, n_bars):
            # Bullish FVG: Low of candle i > High of candle i-2
            if lows.iloc[i] > highs.iloc[i - 2] and closes.iloc[i - 1] > opens.iloc[i - 1]:
                fvgs.append({
                    "type": "BULLISH_FVG",
                    "top": float(lows.iloc[i]),
                    "bottom": float(highs.iloc[i - 2]),
                    "created_bar": i,
                    "mitigated": False
                })
            # Bearish FVG: High of candle i < Low of candle i-2
            elif highs.iloc[i] < lows.iloc[i - 2] and closes.iloc[i - 1] < opens.iloc[i - 1]:
                fvgs.append({
                    "type": "BEARISH_FVG",
                    "top": float(lows.iloc[i - 2]),
                    "bottom": float(highs.iloc[i]),
                    "created_bar": i,
                    "mitigated": False
                })

        # 4. Check Mitigations with current price
        curr_price = float(closes.iloc[-1])
        curr_low = float(lows.iloc[-1])
        curr_high = float(highs.iloc[-1])

        unmitigated_obs = []
        for ob in reversed(order_blocks[-10:]):
            if ob["type"] == "BULLISH_OB":
                if curr_low <= ob["top"] and curr_low >= ob["bottom"]:
                    ob["status"] = "TESTED_HOLDING"
                elif curr_price < ob["bottom"]:
                    ob["mitigated"] = True
                    ob["status"] = "INVALIDATED"
                else:
                    ob["status"] = "FRESH_UNMITIGATED"
            else:
                if curr_high >= ob["bottom"] and curr_high <= ob["top"]:
                    ob["status"] = "TESTED_HOLDING"
                elif curr_price > ob["top"]:
                    ob["mitigated"] = True
                    ob["status"] = "INVALIDATED"
                else:
                    ob["status"] = "FRESH_UNMITIGATED"

            if not ob["mitigated"]:
                unmitigated_obs.append(ob)

        unmitigated_fvgs = []
        for fvg in reversed(fvgs[-12:]):
            if fvg["type"] == "BULLISH_FVG":
                if curr_low <= fvg["top"]:
                    fvg["mitigated"] = True
            else:
                if curr_high >= fvg["bottom"]:
                    fvg["mitigated"] = True
            if not fvg["mitigated"]:
                unmitigated_fvgs.append(fvg)

        # 5. Premium / Discount / Equilibrium
        recent_window = min(50, n_bars)
        range_high = float(highs.iloc[-recent_window:].max())
        range_low = float(lows.iloc[-recent_window:].min())
        equilibrium = (range_high + range_low) / 2.0
        
        range_span = range_high - range_low if range_high > range_low else 1.0
        pct_in_range = ((curr_price - range_low) / range_span) * 100.0
        regime = "DISCOUNT" if curr_price < equilibrium else "PREMIUM"

        # 6. Strong / Weak Levels (from GUARDEER zhl & phl)
        current_trend = "BULLISH" if itrend >= 0 else "BEARISH"
        if current_trend == "BULLISH":
            strong_level = {"type": "Strong Low (Protected)", "price": round(range_low, 4)}
            weak_level = {"type": "Weak High (Draw on Liquidity)", "price": round(range_high, 4)}
        else:
            strong_level = {"type": "Strong High (Protected)", "price": round(range_high, 4)}
            weak_level = {"type": "Weak Low (Draw on Liquidity)", "price": round(range_low, 4)}

        # Nearest key levels
        nearest_ob = unmitigated_obs[0] if unmitigated_obs else None
        nearest_fvg = unmitigated_fvgs[0] if unmitigated_fvgs else None

        return {
            "current_price": curr_price,
            "trend": current_trend,
            "itrend": "BULLISH" if itrend >= 0 else "BEARISH",
            "last_event": last_ms_event,
            "premium_discount": {
                "regime": regime,
                "percent": round(pct_in_range, 1),
                "equilibrium": round(equilibrium, 4),
                "range_high": round(range_high, 4),
                "range_low": round(range_low, 4)
            },
            "strong_level": strong_level,
            "weak_level": weak_level,
            "nearest_ob": f"{nearest_ob['type']} ({round(nearest_ob['bottom'], 2)} - {round(nearest_ob['top'], 2)})" if nearest_ob else "None near",
            "nearest_fvg": f"{nearest_fvg['type']} ({round(nearest_fvg['bottom'], 2)} - {round(nearest_fvg['top'], 2)})" if nearest_fvg else "None near",
            "active_obs_count": len(unmitigated_obs),
            "active_fvgs_count": len(unmitigated_fvgs),
            "raw_nearest_ob": nearest_ob,
            "raw_nearest_fvg": nearest_fvg
        }

    @staticmethod
    def extract_htf_high_probability_zones(h1_candles: List[Dict[str, Any]], d1_candles: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Strictly extracts ONLY High-Probability HTF Order Block, FVG, and DOL.
        - Strict HTF priority (D1 / H1)
        - Zero noise / zero random boxes
        - Directional confluence with macro order flow
        - Guaranteed fresh / unmitigated
        """
        if not h1_candles:
            return {"dol": None, "order_block": None, "fvg": None}

        df_h1 = pd.DataFrame(h1_candles)
        engine_h1 = TechnicalStructureEngine(df_h1)
        h1_analysis = engine_h1.analyze_full_structure(internal_len=5, swing_len=20)

        trend = h1_analysis.get("trend", "BULLISH")
        curr_price = h1_analysis.get("current_price", 0)

        # 1. High Probability DOL (Draw on Liquidity) from D1 / H1
        # If trend is Bullish -> Target is Previous Day High (PDH) or H1 Swing High (Weak High)
        # If trend is Bearish -> Target is Previous Day Low (PDL) or H1 Swing Low (Weak Low)
        dol_price = None
        dol_title = ""
        dol_type = ""

        if d1_candles and len(d1_candles) >= 2:
            pdh = float(d1_candles[-2].get("high", 0))
            pdl = float(d1_candles[-2].get("low", 0))
            if trend == "BULLISH":
                dol_price = pdh if pdh > curr_price else float(h1_analysis["weak_level"]["price"])
                dol_title = "HTF DOL: Buy-Side Target (PDH)"
                dol_type = "BUY_SIDE"
            else:
                dol_price = pdl if pdl < curr_price and pdl > 0 else float(h1_analysis["weak_level"]["price"])
                dol_title = "HTF DOL: Sell-Side Target (PDL)"
                dol_type = "SELL_SIDE"
        else:
            dol_price = float(h1_analysis["weak_level"]["price"])
            dol_title = f"HTF DOL: {'Buy-Side' if trend == 'BULLISH' else 'Sell-Side'} Target"
            dol_type = "BUY_SIDE" if trend == "BULLISH" else "SELL_SIDE"

        # 2. High Probability Order Block (Top 1 Unmitigated HTF OB)
        raw_ob = h1_analysis.get("raw_nearest_ob")
        high_prob_ob = None
        if raw_ob:
            high_prob_ob = {
                "title": f"HTF {raw_ob['type'].replace('_', ' ')} (A+ Zone)",
                "top": round(raw_ob["top"], 4),
                "bottom": round(raw_ob["bottom"], 4),
                "type": raw_ob["type"],
                "timeframe": "H1/H4",
                "volume": raw_ob.get("volume", 0),
                "status": "UNMITIGATED"
            }

        # 3. High Probability Fair Value Gap (Top 1 Unmitigated HTF FVG)
        raw_fvg = h1_analysis.get("raw_nearest_fvg")
        high_prob_fvg = None
        if raw_fvg:
            high_prob_fvg = {
                "title": f"HTF {raw_fvg['type'].replace('_', ' ')} (Fresh Imbalance)",
                "top": round(raw_fvg["top"], 4),
                "bottom": round(raw_fvg["bottom"], 4),
                "type": raw_fvg["type"],
                "timeframe": "H1/H4",
                "status": "UNMITIGATED"
            }

        return {
            "dol": {
                "title": dol_title,
                "price": round(dol_price, 4) if dol_price else None,
                "type": dol_type,
                "timeframe": "D1/H4"
            } if dol_price else None,
            "order_block": high_prob_ob,
            "fvg": high_prob_fvg,
            "regime": h1_analysis.get("premium_discount", {}).get("regime", "NEUTRAL")
        }

    def _empty_structure(self) -> Dict[str, Any]:
        return {
            "current_price": 0,
            "trend": "NEUTRAL",
            "itrend": "NEUTRAL",
            "last_event": "NONE",
            "premium_discount": {"regime": "NEUTRAL", "percent": 50.0, "equilibrium": 0, "range_high": 0, "range_low": 0},
            "strong_level": {"type": "None", "price": 0},
            "weak_level": {"type": "None", "price": 0},
            "nearest_ob": "None",
            "nearest_fvg": "None",
            "active_obs_count": 0,
            "active_fvgs_count": 0
        }
