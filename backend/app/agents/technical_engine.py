import pandas as pd
import numpy as np

class TechnicalStructureEngine:
    def __init__(self, data: pd.DataFrame):
        """
        Initialize with a DataFrame containing OHLCV data.
        Expected columns: ['open', 'high', 'low', 'close', 'volume', 'timestamp']
        """
        self.df = data.copy()
        
    def _pivot_high(self, src: pd.Series, left_len: int, right_len: int) -> pd.Series:
        """
        Replicates PineScript's ta.pivothigh(src, left, right).
        Returns the pivot highs and NaN otherwise.
        """
        pivots = pd.Series(np.nan, index=src.index)
        for i in range(left_len, len(src) - right_len):
            window = src.iloc[i - left_len : i + right_len + 1]
            if src.iloc[i] == window.max():
                pivots.iloc[i] = src.iloc[i]
        return pivots

    def _pivot_low(self, src: pd.Series, left_len: int, right_len: int) -> pd.Series:
        """
        Replicates PineScript's ta.pivotlow(src, left, right).
        Returns the pivot lows and NaN otherwise.
        """
        pivots = pd.Series(np.nan, index=src.index)
        for i in range(left_len, len(src) - right_len):
            window = src.iloc[i - left_len : i + right_len + 1]
            if src.iloc[i] == window.min():
                pivots.iloc[i] = src.iloc[i]
        return pivots

    def calculate_market_structure(self, internal_len: int = 5, swing_len: int = 50):
        """
        Calculates both internal and swing market structure (BOS, CHoCH, CHoCH+)
        based on the provided lookback lengths.
        """
        # Calculate Pivots
        self.df['iH'] = self._pivot_high(self.df['high'], internal_len, internal_len)
        self.df['iL'] = self._pivot_low(self.df['low'], internal_len, internal_len)
        self.df['sH'] = self._pivot_high(self.df['high'], swing_len, swing_len)
        self.df['sL'] = self._pivot_low(self.df['low'], swing_len, swing_len)
        
        # Identify internal trend states, BOS, CHoCH (logic stubbed)
        self.df['internal_trend'] = 0
        self.df['ms_event'] = None # "BOS", "CHoCH", "CHoCH+"
        
        # NOTE: A full translation of the PineScript structure state machine goes here
        # For each row, we'd check if close crosses over previous iH/iL to determine BOS/CHoCH
        
        return self.df

    def detect_fvg(self, wick_mitigation: bool = False):
        """
        Detects Fair Value Gaps (FVG, VI, OG) in the data.
        """
        # Bullish FVG: low of candle 3 > high of candle 1
        self.df['fvg_bull'] = (self.df['low'] > self.df['high'].shift(2)) & (self.df['close'].shift(1) > self.df['open'].shift(1))
        
        # Bearish FVG: high of candle 3 < low of candle 1
        self.df['fvg_bear'] = (self.df['high'] < self.df['low'].shift(2)) & (self.df['close'].shift(1) < self.df['open'].shift(1))
        
        return self.df
