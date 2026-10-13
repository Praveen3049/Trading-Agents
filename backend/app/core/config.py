import os
from pathlib import Path
from dotenv import load_dotenv

# Search for .env in backend/ or root
base_dir = Path(__file__).resolve().parent.parent.parent
env_paths = [
    base_dir / ".env",
    base_dir.parent / ".env"
]

for env_path in env_paths:
    if env_path.exists():
        load_dotenv(dotenv_path=env_path, override=True)
        break

class Settings:
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "") or os.getenv("GOOGLE_API_KEY", "")
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    LLM_PROVIDER: str = os.getenv("LLM_PROVIDER", "gemini").lower()
    
    # Preferred models
    GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
    OPENAI_MODEL: str = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

settings = Settings()
