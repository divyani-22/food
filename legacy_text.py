"""English-only display helpers for FreshGuard data.

Older databases may hold Korean names/labels and emoji saved by earlier versions.
These helpers strip emoji and translate known legacy labels to English.
"""
import re

LEGACY_KO_TO_EN = {
    "\ud30c\ud504\ub9ac\uce74/\ud53c\ub9dd": "Bell Pepper", "\uc0ac\uacfc": "Apple", "\ubc14\ub098\ub098": "Banana", "\ub2f9\uadfc": "Carrot",
    "\uc624\uc774": "Cucumber", "\ub9dd\uace0": "Mango", "\uc624\ub80c\uc9c0": "Orange", "\uac10\uc790": "Potato", "\ub538\uae30": "Strawberry",
    "\ud1a0\ub9c8\ud1a0": "Tomato", "\uc2dd\uc7ac\ub8cc": "Produce",
    "\uc2e0\uc120\ud568 (Fresh)": "Fresh", "\uc0c1\ud568/\ubd80\ud328 (Rotten)": "Rotten", "\ubcf4\ud1b5 (Normal)": "Normal",
    "\uc2e0\uc120": "Fresh", "\ubcf4\ud1b5": "Normal", "\uc0c1\ud568": "Rotten",
}
_EMOJI_RE = re.compile("[\U0001F000-\U0001FAFF\u2600-\u27BF\uFE0F\u200D]")
_HANGUL_RE = re.compile("[\uac00-\ud7af]")


def englishify(text):
    """Strip emoji and translate known legacy Korean labels to English."""
    if not isinstance(text, str):
        return text
    out = _EMOJI_RE.sub("", text)
    for ko in sorted(LEGACY_KO_TO_EN, key=len, reverse=True):
        out = out.replace(ko, LEGACY_KO_TO_EN[ko])
    return out.strip()
