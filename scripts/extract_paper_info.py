"""
Extract paper citation information from Confidence Database readme files.

Reads all readme_*.txt files, extracts citation text, paper title, DOI URL,
and any other paper URL. Outputs to datasheet/paper_info.csv.
"""

import csv
import os
import re
from pathlib import Path

# Directories
BASE_DIR = Path(__file__).resolve().parent.parent
README_DIR = BASE_DIR / "conf_db_data" / "Confidence Database"
OUTPUT_FILE = BASE_DIR / "datasheet" / "paper_info.csv"


def strip_rtf(text: str) -> str:
    """Remove RTF formatting codes from text, preserving readable content."""
    if not text.startswith("{\\rtf"):
        return text

    # Extract HYPERLINK URLs before stripping
    hyperlink_urls = re.findall(r'HYPERLINK\s+"([^"]+)"', text)

    # Simple RTF-to-text approach: remove control words and braces,
    # keep plain text content
    result = []
    i = 0
    depth = 0
    skip_group = 0  # depth at which we started skipping
    in_skip = False

    while i < len(text):
        ch = text[i]

        if ch == "{":
            depth += 1
            # Check if this group should be skipped (fonttbl, colortbl, etc.)
            rest = text[i + 1 : i + 30]
            if re.match(r"\\(?:fonttbl|colortbl|\*\\expandedcolortbl|\*\\fldinst)", rest):
                in_skip = True
                skip_group = depth
            i += 1
        elif ch == "}":
            if in_skip and depth == skip_group:
                in_skip = False
            depth -= 1
            i += 1
        elif in_skip:
            i += 1
        elif ch == "\\":
            # Control word or escaped char
            if i + 1 < len(text):
                next_ch = text[i + 1]
                if next_ch == "\n":
                    # \<newline> = paragraph break in RTF
                    result.append("\n")
                    i += 2
                elif next_ch == "'":
                    # Hex escape like \'b0
                    if i + 3 < len(text):
                        hex_code = text[i + 2 : i + 4]
                        try:
                            result.append(chr(int(hex_code, 16)))
                        except ValueError:
                            pass
                        i += 4
                    else:
                        i += 2
                elif next_ch.isalpha():
                    # Control word: \word123 possibly followed by space
                    match = re.match(r"\\([a-zA-Z]+)(-?\d+)?\s?", text[i:])
                    if match:
                        word = match.group(1)
                        i += len(match.group(0))
                        # Some control words produce characters
                        if word == "par":
                            result.append("\n")
                        elif word == "tab":
                            result.append("\t")
                        elif word == "line":
                            result.append("\n")
                        # Otherwise skip the control word
                    else:
                        i += 1
                else:
                    # Escaped special char like \{ \} \\
                    result.append(next_ch)
                    i += 2
            else:
                i += 1
        else:
            result.append(ch)
            i += 1

    output = "".join(result)
    # Clean up multiple spaces
    output = re.sub(r"[ \t]+", " ", output)
    output = re.sub(r"\n\s*\n+", "\n", output)

    # Re-insert URLs that were in HYPERLINK fields
    for url in hyperlink_urls:
        if url not in output:
            output = output.rstrip() + " " + url

    return output.strip()


def read_readme(filepath: Path) -> str:
    """Read a readme file, trying multiple encodings."""
    for encoding in ["utf-8", "utf-8-sig", "latin-1", "cp1252"]:
        try:
            return filepath.read_text(encoding=encoding)
        except (UnicodeDecodeError, UnicodeError):
            continue
    return filepath.read_text(encoding="latin-1", errors="replace")


def extract_citation_text(content: str, filename: str) -> str:
    """
    Extract the citation text from readme content.

    Handles multiple formats:
    - "Citation: <text>" (most common)
    - "Citation\\n<text>" (on next line)
    - "* Citation: <text>" (bullet format)
    - "- Citation: <text>" (dash format)
    - "## Citation\\n<text>" (markdown)
    - "Dataset from: <text>" (Faivre files)
    - "CitationText" (no separator, single-line files)
    - Multi-line citations that continue on the next line(s)
    """
    # Handle RTF files (Xue_2024)
    if content.startswith("{\\rtf"):
        content = strip_rtf(content)

    lines = content.split("\n")

    # Strategy 1: Look for "Dataset from:" pattern (Faivre files)
    for i, line in enumerate(lines):
        stripped = line.strip()
        match = re.match(r"^Dataset from:\s*(.+)", stripped, re.IGNORECASE)
        if match:
            citation = match.group(1).strip()
            # Continue to next lines if they look like part of the citation
            citation = _collect_continuation(lines, i, citation)
            return citation.strip()

    # Strategy 2: Find the Citation line
    for i, line in enumerate(lines):
        stripped = line.strip()

        # Match various citation label patterns
        # "Citation: text", "* Citation: text", "- Citation: text", "## Citation", "Citation" (bare)
        match = re.match(
            r"^[\*\-#\s]*Citation\b\s*:?\s*(.*)",
            stripped,
            re.IGNORECASE,
        )
        if not match:
            # Also match "CitationText" (no space/colon, single-line files like Bang)
            match = re.match(r"^Citation([A-Z][a-z].*)", stripped)
            if not match:
                continue

        citation = match.group(1).strip().strip("#").strip()

        # If the citation text is on this line
        if citation:
            # Check if it's a non-citation indicator
            if _is_no_citation(citation):
                return ""
            citation = _collect_continuation(lines, i, citation)
            return citation.strip()

        # Citation text might be on the next line(s)
        # Skip blank lines and decorative dividers (e.g., "################")
        for offset in range(1, 4):
            if i + offset >= len(lines):
                break
            next_line = lines[i + offset].strip()
            # Skip blank lines and divider lines (all #, all =, all -)
            if not next_line or re.match(r"^[#=\-]+$", next_line):
                continue
            if not _is_section_header(next_line):
                if _is_no_citation(next_line):
                    return ""
                citation = next_line
                citation = _collect_continuation(lines, i + offset, citation)
                return citation.strip()
            break

    # Strategy 3: For single-line files (like Bang, Zheng_2023), look for "Citation"
    # keyword in the middle of a long line. Use * as delimiter for bullet-format files.
    full_text = " ".join(l.strip() for l in lines)
    # Try bullet-delimited format first: "* Citation: text* Task: ..."
    match = re.search(
        r"Citation\s*[:\s]\s*(.+?)(?:\*\s*(?:Task|Stimulus|Condition|Block|Subjects|Group|Cued))",
        full_text,
        re.IGNORECASE,
    )
    if match:
        citation = match.group(1).strip().rstrip("*").strip()
        if citation and not _is_no_citation(citation):
            return citation.strip().rstrip(".")
    # Try non-bullet format: "CitationText...StimulusText..."
    match = re.search(
        r"Citation\s*[:\s]\s*([^*]+?)(?:(?:The dataset|These data|Stimulus|Task|$))",
        full_text,
        re.IGNORECASE,
    )
    if match:
        citation = match.group(1).strip()
        if citation and not _is_no_citation(citation):
            return citation.strip().rstrip(".")

    return ""


def _is_no_citation(text: str) -> bool:
    """Check if the text indicates no citation is available."""
    lower = text.lower().strip().rstrip(".")
    no_patterns = [
        "unpublished",
        "unpub",
        "not published",
        "no associated paper",
        "no associated published paper",
        "these data are not published",
        "there is currently no associated",
        "in prep",
        "in preparation",
        "paper in preparation",
    ]
    for pat in no_patterns:
        if pat in lower:
            return True
    # Very short text that's clearly not a real citation
    if len(lower) < 5 and lower not in ("", ):
        return True
    return False


def _is_section_header(line: str) -> bool:
    """Check if a line looks like a section header rather than citation continuation."""
    stripped = line.strip()
    # Blank line
    if not stripped:
        return True
    # Common section headers
    headers = [
        "stimulus", "response", "confidence", "manipulations", "block size",
        "feedback", "subject", "experiment", "training", "special",
        "these data", "the dataset", "task", "link to", "number of",
        "location", "data collection", "response device", "##",
        "condition", "accuracy", "rt", "day", "subj_idx",
    ]
    lower = stripped.lower().lstrip("*- ")
    for h in headers:
        if lower.startswith(h):
            return True
    return False


def _collect_continuation(lines: list, start_idx: int, current: str) -> str:
    """Collect continuation lines that are part of the same citation."""
    result = current
    for j in range(start_idx + 1, min(start_idx + 10, len(lines))):
        next_line = lines[j].strip()
        if not next_line:
            break
        if _is_section_header(next_line):
            break
        # Check if this looks like a continuation (starts with lowercase,
        # or starts with "&", or looks like authors/journal text, or is a URL)
        if (
            next_line[0].islower()
            or next_line.startswith("&")
            or next_line.startswith("(")
            or next_line.startswith("http")
            or re.match(r"^[A-Z][a-z]+,?\s", next_line)  # Author name continuation
            or re.match(r"^perceptual|^in\s|^doi", next_line, re.IGNORECASE)
        ):
            result += " " + next_line
        else:
            break
    return result


def extract_doi(text: str) -> str:
    """Extract DOI URL from citation text."""
    if not text:
        return ""

    # Match https://doi.org/... or http://doi.org/... or http://dx.doi.org/...
    # Allow for spaces within DOI (common typo in readme files, e.g., "journal. pcbi")
    match = re.search(r"https?://(?:dx\.)?doi\.org/([\S]+(?:\s[\S]+)*)", text)
    if match:
        raw = match.group(1)
        # Try to reconstruct DOI by removing errant spaces
        # Only join words that look like DOI parts (contain dots/digits/slashes)
        parts = raw.split()
        doi_path = parts[0]
        for p in parts[1:]:
            # If next part looks like a DOI continuation (starts with letter/digit,
            # and previous part ended in a dot or the part starts with a dot-like char)
            if doi_path.endswith(".") or re.match(r"^[a-z0-9]", p, re.IGNORECASE):
                # Check if combining them looks plausible as a DOI
                if re.match(r"^[a-zA-Z0-9._\-/]+$", p.rstrip(".,;)")):
                    doi_path += p
                    continue
            break
        doi_path = doi_path.rstrip(".,;)")
        return f"https://doi.org/{doi_path}"

    # Match doi.org/10.xxxx (without https://)
    match = re.search(r"(?<!//)doi\.org/([\S]+)", text)
    if match:
        doi_num = match.group(1).rstrip(".,;)")
        return f"https://doi.org/{doi_num}"

    # Match doi:10.xxxx/... or DOI: 10.xxxx format
    # Allow non-breaking spaces and other whitespace variants between DOI: and number
    match = re.search(r"doi[:\s\u00a0\u00ca]+(\d{2}\.\d{4,}/[\S]+)", text, re.IGNORECASE)
    if match:
        doi_num = match.group(1).rstrip(".,;)")
        return f"https://doi.org/{doi_num}"

    # Match www.pnas.org/cgi/doi/... or similar journal DOI URLs
    match = re.search(r"www\.\S+/doi/(\d{2}\.\d{4,}/\S+)", text)
    if match:
        doi_num = match.group(1).rstrip(".,;)")
        return f"https://doi.org/{doi_num}"

    return ""


def extract_url(text: str, doi: str) -> str:
    """Extract a non-DOI URL from citation text."""
    if not text:
        return ""

    # Find all URLs
    urls = re.findall(r"https?://[\S]+", text)
    for url in urls:
        url = url.rstrip(".,;)")
        # Skip DOI URLs (already captured)
        if "doi.org" in url or "dx.doi.org" in url:
            continue
        return url

    # Check for www URLs without http
    match = re.search(r"www\.[\S]+", text)
    if match:
        url = match.group(0).rstrip(".,;)")
        if "doi" not in url:
            return f"https://{url}"

    return ""


def extract_title(citation: str) -> str:
    """
    Extract the paper title from a citation string.

    Most citations follow APA-ish format:
      Authors (year). Title. Journal, ...
      or Authors (year, Exp. N). Title. Journal, ...

    Some variations:
      - "Data from Experiment N of Authors (year). Title. ..."
      - Authors (forthcoming). Title. ...
      - "Title", Journal (Gherman format)
    """
    if not citation:
        return ""

    text = citation.strip()

    # Handle "Data from Experiment N of ..." prefix
    data_from_match = re.match(
        r"^Data from Experiment \d+ of\s+(.+)", text, re.IGNORECASE
    )
    if data_from_match:
        text = data_from_match.group(1).strip()

    # Handle quoted title format (Gherman): "Title", Journal
    quoted_match = re.match(r'^["\u201c](.+?)["\u201d]', text)
    if quoted_match:
        return quoted_match.group(1).strip()

    # Handle bullet-point Rahnev format: "* Citation: Title. Journal..."
    # (already stripped of "* Citation: " prefix)

    # Standard APA: look for (year) or (year, ...) then title follows
    # Pattern: stuff (YYYY...). Title. Journal...
    # The title is between the first "). " and the next ". " that's followed by journal info
    year_match = re.search(
        r"\(\s*(?:\d{4}|forthcoming|in press|provisionally accepted)[^)]*\)\s*\.?\s*",
        text,
        re.IGNORECASE,
    )
    if year_match:
        after_year = text[year_match.end() :].strip()
        # The title ends at the next period followed by a space and then
        # journal name (capitalized word) or at the end
        # But titles can contain periods (abbreviations), so we need to be careful
        # Look for ". " followed by a journal-like pattern or end
        title = _extract_title_from_after_year(after_year)
        if title:
            return title

    # Fallback: If no year pattern found, try to find title between first period groups
    # Some citations start directly with title
    parts = re.split(r"\.\s+", text)
    if len(parts) >= 2:
        # Skip parts that look like author lists
        for part in parts:
            part = part.strip()
            if len(part) > 20 and not re.match(r"^[A-Z][a-z]+,\s", part):
                return part.rstrip(".")

    # If the entire citation text looks like a title (no year, no journal, no authors with commas)
    # e.g., "A common computational principle for decision-making with confidence..."
    if len(text) > 20 and not re.search(r"\(\d{4}", text):
        return text.rstrip(".")

    return ""


def _extract_title_from_after_year(text: str) -> str:
    """Extract paper title from text that comes after the (year) in a citation."""
    if not text:
        return ""

    # Split by ". " but be careful with abbreviations
    # Strategy: find the title which ends before journal name
    # Journal names often have patterns like: Journal of..., Frontiers in...,
    # Psychological..., PLOS..., Nature..., etc.

    # Try splitting on ". " and taking the first substantial segment
    # that looks like a title (not a journal abbreviation)
    segments = re.split(r"\.\s+", text)

    if not segments:
        return ""

    # If first segment is short and might be experiment info ("THIS IS EXPERIMENT 1"),
    # skip it
    title_parts = []
    for seg in segments:
        seg = seg.strip()
        if not seg:
            continue
        # Check if this segment is a journal/volume reference
        if _looks_like_journal(seg):
            break
        # Check if this is experiment info to skip
        if re.match(r"^THIS IS EXPERIMENT", seg, re.IGNORECASE):
            break
        title_parts.append(seg)
        # Most titles are a single segment; multi-segment titles are rare
        # Break after first substantial segment unless it seems incomplete
        if len(seg) > 15 and not seg.endswith(":"):
            break

    title = ". ".join(title_parts).strip().rstrip(".")
    return title


def _looks_like_journal(text: str) -> str:
    """Check if text looks like a journal name/reference rather than a title."""
    # Common journal name patterns
    journal_patterns = [
        r"^(?:Journal of|Frontiers in|PLOS|PLoS|Nature|Science |Psychological|Consciousness|"
        r"Neuroscience of|Cognition|eLife|bioRxiv|PsyArXiv|Psychonomic|Memory|"
        r"Acta Psychol|Attention|Scientific [Rr]eports|Scientific [Dd]ata|"
        r"Biological [Pp]sychiatry|Proc\.|PNAS|Thinking|J\.|The Journal|"
        r"Brain|Cortex|Neuropsychologia|NeuroImage|Neuron|Current Biology)",
        r"^\d+\s*\(",  # Volume number like "38(22)"
        r"^\d+:\s*\d+",  # Pages like "148(3):437-452"
    ]
    for pat in journal_patterns:
        if re.match(pat, text, re.IGNORECASE):
            return True
    return False


def process_readme(filepath: Path) -> dict:
    """Process a single readme file and extract paper information."""
    filename = filepath.name
    # Extract dataset_id: readme_Adler_2018_Expt1.txt -> Adler_2018_Expt1
    dataset_id = filename.replace("readme_", "").replace(".txt", "")

    content = read_readme(filepath)

    # Strip RTF formatting early so all extraction works on clean text
    if content.startswith("{\\rtf"):
        content = strip_rtf(content)

    citation = extract_citation_text(content, filename)
    doi = extract_doi(citation)
    url = extract_url(citation, doi)
    title = extract_title(citation)

    # For the "Dataset from:" pattern, also try extracting DOI/URL from full content
    if not doi:
        doi = extract_doi(content)
    if not url and not doi:
        url = extract_url(content, "")

    return {
        "dataset_id": dataset_id,
        "paper_title": title,
        "paper_doi": doi,
        "paper_url": url,
        "citation_text": citation,
    }


def main():
    readme_dir = README_DIR
    if not readme_dir.exists():
        print(f"ERROR: Directory not found: {readme_dir}")
        return

    readme_files = sorted(readme_dir.glob("readme_*.txt"))
    print(f"Found {len(readme_files)} readme files")

    results = []
    for filepath in readme_files:
        info = process_readme(filepath)
        results.append(info)

    # Also create entries for data files that have no matching readme
    data_files = sorted(readme_dir.glob("data_*.csv"))
    readme_ids = {r["dataset_id"] for r in results}
    for data_file in data_files:
        dataset_id = data_file.name.replace("data_", "").replace(".csv", "")
        if dataset_id not in readme_ids:
            results.append({
                "dataset_id": dataset_id,
                "paper_title": "",
                "paper_doi": "",
                "paper_url": "",
                "citation_text": "",
            })
            print(f"  No readme for: {dataset_id}")

    # Sort by dataset_id
    results.sort(key=lambda x: x["dataset_id"])

    # Write CSV
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_FILE, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["dataset_id", "paper_title", "paper_doi", "paper_url", "citation_text"],
        )
        writer.writeheader()
        writer.writerows(results)

    # Summary statistics
    total = len(results)
    has_citation = sum(1 for r in results if r["citation_text"])
    has_doi = sum(1 for r in results if r["paper_doi"])
    has_url = sum(1 for r in results if r["paper_url"])
    has_title = sum(1 for r in results if r["paper_title"])
    no_citation = total - has_citation

    print(f"\nResults written to: {OUTPUT_FILE}")
    print(f"  Total datasets:       {total}")
    print(f"  With citation text:   {has_citation}")
    print(f"  With paper title:     {has_title}")
    print(f"  With DOI:             {has_doi}")
    print(f"  With other URL:       {has_url}")
    print(f"  No citation (unpub/missing): {no_citation}")

    # List datasets with citations but no extracted title (for debugging)
    no_title = [r for r in results if r["citation_text"] and not r["paper_title"]]
    if no_title:
        print(f"\n  WARNING: {len(no_title)} datasets have citation text but no extracted title:")
        for r in no_title:
            print(f"    - {r['dataset_id']}: {r['citation_text'][:80]}...")


if __name__ == "__main__":
    main()
