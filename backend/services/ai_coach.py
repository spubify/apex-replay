import json
import os
import re
from typing import Dict, Any, List, Optional

import numpy as np

try:
    from google import genai
except ImportError:
    genai = None


class AICoachService:
    def __init__(self):
        self.api_key = os.getenv("GEMINI_API_KEY")
        self.model_name = os.getenv("GEMINI_MODEL", "gemini-2.5-pro")
        self.client = None

        if self.api_key and genai:
            try:
                self.client = genai.Client(api_key=self.api_key)
            except TypeError:
                # Older versions expect the key in the environment
                os.environ.setdefault("GOOGLE_API_KEY", self.api_key)
                self.client = genai.Client()
            except Exception as exc:
                print(f"⚠️  Gemini client init failed: {exc}")
                self.client = None
        else:
            if not self.api_key:
                print("⚠️  GEMINI_API_KEY not set, AI coach disabled.")
            if not genai:
                print("⚠️  google-genai package not available, AI coach disabled.")

    def _build_prompt_payload(self, compare_result: Dict[str, Any]) -> Dict[str, Any]:
        payload = {
            "lap_time": compare_result.get("user_lap_formatted"),
            "golden_time": compare_result.get("golden_lap_formatted"),
            "time_diff": compare_result.get("time_diff"),
            "recommendations": compare_result.get("recommendations", [])[:5],
            "consistency": {
                "score": compare_result.get("consistency", {}).get("score"),
                "average": compare_result.get("consistency", {}).get("average_formatted"),
                "issues": compare_result.get("consistency", {}).get("outliers", []),
            },
            "hot_zones": compare_result.get("hot_zones", {}).get("weak", [])[:4],
            "progression": compare_result.get("progression", {}).get("insights", []),
            "weather": (compare_result.get("session_context") or {}).get("weather"),
            "race_results": (compare_result.get("session_context") or {}).get("race_results"),
        }
        return payload

    def generate_insights(self, compare_result: Dict[str, Any]) -> Dict[str, Any]:
        if not self.client:
            return {
                "summary": "AI Coach is not configured. Set GEMINI_API_KEY to enable enhanced guidance.",
                "recommendations": []
            }

        payload = self._build_prompt_payload(compare_result)
        def serialize_payload(data: Dict[str, Any]) -> str:
            class Encoder(json.JSONEncoder):
                def default(self, obj):
                    if isinstance(obj, np.integer):
                        return int(obj)
                    if isinstance(obj, np.floating):
                        return float(obj)
                    if hasattr(obj, 'item'):
                        try:
                            return obj.item()
                        except Exception:
                            return super().default(obj)
                    return super().default(obj)

            return json.dumps(data, cls=Encoder)

        prompt = f"""
You are Apex Replay, an expert driving instructor.
Analyze the telemetry summary below and produce targeted coaching recommendations and specific track insights.

DATA (JSON):
{serialize_payload(payload)}

Respond strictly in JSON using this schema:
{{
  "summary": "High level overview in <=60 words.",
  "race_brief": "Optional note (<=40 words) about track/weather/race context if relevant.",
  "recommendations": [
    {{
      "title": "Short hook (<=6 words)",
      "detail": "Actionable explanation (<=60 words)",
      "focus_area": "e.g. Braking, Turn-in, Exit, Consistency, Racecraft",
      "estimated_gain": "Optional description like '+0.25s' or 'Maintain +6 km/h'",
      "confidence": "high|medium|low"
    }}
  ],
  "track_insights": [
    {{
      "sector": 1, // integer sector number (1-based)
      "type": "Braking|Line|Throttle|Gear|Strategy",
      "color": "#hexcode", // Use mapping below
      "message": "Short insight (<= 5 words)",
      "detail": "Detailed explanation (<= 20 words)"
    }}
  ]
}}

COLOR MAPPING for track_insights:
- Braking: #ef4444 (Red)
- Line: #3b82f6 (Blue)
- Throttle: #10b981 (Green)
- Gear: #f59e0b (Amber)
- Strategy: #8b5cf6 (Purple)
"""
        try:
            response = self.client.models.generate_content(
                model=self.model_name,
                contents=prompt
            )
            text = self._extract_json_block(response.text)
            if not text:
                raise ValueError("Gemini response lacked JSON content.")
            data = json.loads(text)
            summary = data.get("summary") or "AI Coach summary unavailable."
            recs = data.get("recommendations") or []
            track_insights = data.get("track_insights") or []
            race_brief = data.get("race_brief")
            
            cleaned_recs: List[Dict[str, str]] = []
            for rec in recs:
                cleaned_recs.append({
                    "title": rec.get("title", "Suggested focus"),
                    "detail": rec.get("detail", ""),
                    "focus_area": rec.get("focus_area", "Driving"),
                    "estimated_gain": rec.get("estimated_gain"),
                    "confidence": rec.get("confidence", "medium")
                })
                
            return {
                "summary": summary,
                "ai_recommendations": cleaned_recs,
                "track_insights": track_insights,
                "race_brief": race_brief
            }
        except json.JSONDecodeError:
            print("⚠️  Gemini response was not valid JSON.")
        except Exception as exc:
            print(f"⚠️  Gemini request failed: {exc}")

        return {
            "summary": "AI Coach is temporarily unavailable.",
            "recommendations": []
        }

    def _extract_json_block(self, raw_text: Optional[str]) -> Optional[str]:
        if not raw_text:
            return None
        stripped = raw_text.strip()
        if stripped.startswith("{"):
            return stripped
        fenced = re.search(r"```(?:json)?\s*(.*?)```", stripped, re.DOTALL | re.IGNORECASE)
        if fenced:
            return fenced.group(1).strip()
        return stripped


ai_coach = AICoachService()
