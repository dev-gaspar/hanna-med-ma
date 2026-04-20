import React from "react";

/**
 * Parse inline formatting: **bold**, *italic*, _italic_, ~strikethrough~, `code`.
 *
 * - Standard Markdown: `**bold**` wins over `*italic*` (we try the double-asterisk
 *   pattern first, then fall back to single-asterisk which we treat as italic).
 * - Legacy support: some older sub-agent outputs use `*text*` as bold. Rendered as
 *   italic now is acceptable — visually close and doesn't destroy semantics.
 *
 * Recursive so styles can nest (e.g. bold + italic).
 */
export const parseInlineFormatting = (text: string): React.ReactNode[] => {
	const result: React.ReactNode[] = [];
	let remaining = text;
	let keyIndex = 0;

	const patterns: {
		regex: RegExp;
		render: (match: string, content: string) => React.ReactNode;
	}[] = [
		// Inline code: `text`
		{
			regex: /`([^`]+)`/,
			render: (_, content) => (
				<code
					key={`code-${keyIndex++}`}
					className="bg-n-100 text-n-800 px-1.5 py-0.5 rounded text-[11.5px] font-mono"
				>
					{content}
				</code>
			),
		},
		// Bold: **text** (standard Markdown) — must run BEFORE single-asterisk italic
		{
			regex: /\*\*([^*]+(?:\*(?!\*)[^*]*)*)\*\*/,
			render: (_, content) => (
				<strong key={`bold-${keyIndex++}`} className="font-semibold">
					{parseInlineFormatting(content)}
				</strong>
			),
		},
		// Italic: *text*
		{
			regex: /(?<!\*)\*([^*\n]+)\*(?!\*)/,
			render: (_, content) => (
				<em key={`italic-${keyIndex++}`} className="italic">
					{parseInlineFormatting(content)}
				</em>
			),
		},
		// Italic underscore: _text_
		{
			regex: /(?<![A-Za-z0-9_])_([^_\n]+)_(?![A-Za-z0-9_])/,
			render: (_, content) => (
				<em key={`italic-u-${keyIndex++}`} className="italic text-n-500">
					{parseInlineFormatting(content)}
				</em>
			),
		},
		// Strikethrough: ~text~
		{
			regex: /~([^~]+)~/,
			render: (_, content) => (
				<del key={`strike-${keyIndex++}`} className="line-through">
					{parseInlineFormatting(content)}
				</del>
			),
		},
	];

	while (remaining) {
		let earliestMatch: {
			index: number;
			pattern: (typeof patterns)[0];
			match: RegExpMatchArray;
		} | null = null;

		for (const pattern of patterns) {
			const match = remaining.match(pattern.regex);
			if (match && match.index !== undefined) {
				if (!earliestMatch || match.index < earliestMatch.index) {
					earliestMatch = { index: match.index, pattern, match };
				}
			}
		}

		if (earliestMatch) {
			if (earliestMatch.index > 0) {
				result.push(remaining.slice(0, earliestMatch.index));
			}
			result.push(
				earliestMatch.pattern.render(
					earliestMatch.match[0],
					earliestMatch.match[1],
				),
			);
			remaining = remaining.slice(
				earliestMatch.index + earliestMatch.match[0].length,
			);
		} else {
			result.push(remaining);
			break;
		}
	}

	return result;
};

/**
 * Parse Markdown-flavoured free-form text into React elements.
 *
 * Supports:
 *   - `#`, `##`, `###`, `####` headings
 *   - `**bold**`, `*italic*`, `_italic_`, `~strike~`, `` `code` ``
 *   - Bullet lists (`- item` or `* item`), numbered lists (`1. item`)
 *   - Blockquotes (`> text`)
 *   - Horizontal rule (`---` or `***`)
 *   - Fenced code blocks (```lang ... ```)
 *   - Blank lines between blocks
 *
 * Headings render in our Newsreader serif so they feel clinical, not marketing.
 */
export const parseWhatsAppFormat = (text: string): React.ReactNode[] => {
	const lines = text.split("\n");
	const result: React.ReactNode[] = [];
	let listBuffer: { type: "bullet" | "numbered"; items: string[] } | null =
		null;
	let codeBlockBuffer: string[] | null = null;
	let quoteBuffer: string[] | null = null;
	let paragraphBuffer: string[] | null = null;
	let lineKey = 0;

	const flushParagraph = () => {
		if (paragraphBuffer && paragraphBuffer.length > 0) {
			const joined = paragraphBuffer.join(" ").trim();
			if (joined) {
				result.push(
					<p
						key={`p-${lineKey}`}
						className="leading-[1.65] [&:not(:last-child)]:mb-2"
					>
						{parseInlineFormatting(joined)}
					</p>,
				);
			}
			paragraphBuffer = null;
		}
	};

	const flushListBuffer = () => {
		if (listBuffer) {
			const ListTag = listBuffer.type === "numbered" ? "ol" : "ul";
			const items = listBuffer.items;
			const kind = listBuffer.type;
			result.push(
				<ListTag
					key={`list-${lineKey}`}
					className={
						kind === "numbered"
							? "list-decimal ml-5 my-2 space-y-0.5 marker:text-n-400"
							: "list-disc ml-5 my-2 space-y-0.5 marker:text-n-400"
					}
				>
					{items.map((item, i) => (
						<li key={i} className="leading-[1.6]">
							{parseInlineFormatting(item)}
						</li>
					))}
				</ListTag>,
			);
			listBuffer = null;
		}
	};

	const flushQuoteBuffer = () => {
		if (quoteBuffer) {
			const q = quoteBuffer;
			result.push(
				<blockquote
					key={`quote-${lineKey}`}
					className="border-l-2 border-n-300 pl-3 my-2 italic text-n-600"
				>
					{q.map((line, i) => (
						<span key={i}>
							{parseInlineFormatting(line)}
							{i < q.length - 1 && <br />}
						</span>
					))}
				</blockquote>,
			);
			quoteBuffer = null;
		}
	};

	const flushCodeBlock = () => {
		if (codeBlockBuffer) {
			result.push(
				<pre
					key={`code-${lineKey}`}
					className="bg-n-50 border border-n-150 text-n-800 p-3 rounded-md my-2 overflow-x-auto font-mono text-[11.5px] leading-[1.55]"
				>
					<code>{codeBlockBuffer.join("\n")}</code>
				</pre>,
			);
			codeBlockBuffer = null;
		}
	};

	const flushAll = () => {
		flushParagraph();
		flushListBuffer();
		flushQuoteBuffer();
	};

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		lineKey = i;

		// Fenced code block toggle (```)
		if (line.trim().startsWith("```")) {
			if (codeBlockBuffer === null) {
				flushAll();
				codeBlockBuffer = [];
			} else {
				flushCodeBlock();
			}
			continue;
		}

		if (codeBlockBuffer !== null) {
			codeBlockBuffer.push(line);
			continue;
		}

		// Headings: # / ## / ### / ####
		const headingMatch = line.match(/^(#{1,4})\s+(.+?)\s*#*\s*$/);
		if (headingMatch) {
			flushAll();
			const level = headingMatch[1].length;
			const content = headingMatch[2];
			const common = "font-serif text-n-900 tracking-tight";
			const byLevel: Record<number, string> = {
				1: "text-[20px] leading-[1.2] mt-3 mb-2 font-medium",
				2: "text-[17px] leading-[1.25] mt-3 mb-1.5 font-medium",
				3: "text-[15px] leading-[1.3] mt-2.5 mb-1 font-medium",
				4: "text-[13.5px] leading-[1.35] mt-2 mb-1 font-semibold uppercase tracking-wider text-n-600 font-sans",
			};
			const Tag = (`h${Math.min(level + 1, 4)}` as "h2" | "h3" | "h4");
			result.push(
				<Tag key={`h-${i}`} className={`${common} ${byLevel[level]}`}>
					{parseInlineFormatting(content)}
				</Tag>,
			);
			continue;
		}

		// Horizontal rule
		if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
			flushAll();
			result.push(
				<hr key={`hr-${i}`} className="my-3 border-t border-n-150" />,
			);
			continue;
		}

		// Bullet list: - item or * item (ensure space after marker)
		const bulletMatch = line.match(/^\s*[-*]\s+(.+)$/);
		if (bulletMatch) {
			flushParagraph();
			flushQuoteBuffer();
			if (listBuffer?.type !== "bullet") {
				flushListBuffer();
				listBuffer = { type: "bullet", items: [] };
			}
			listBuffer.items.push(bulletMatch[1]);
			continue;
		}

		// Numbered list: 1. item
		const numberedMatch = line.match(/^\s*\d+\.\s+(.+)$/);
		if (numberedMatch) {
			flushParagraph();
			flushQuoteBuffer();
			if (listBuffer?.type !== "numbered") {
				flushListBuffer();
				listBuffer = { type: "numbered", items: [] };
			}
			listBuffer.items.push(numberedMatch[1]);
			continue;
		}

		// Quote: > text
		const quoteMatch = line.match(/^>\s*(.*)$/);
		if (quoteMatch) {
			flushParagraph();
			flushListBuffer();
			if (!quoteBuffer) quoteBuffer = [];
			quoteBuffer.push(quoteMatch[1]);
			continue;
		}

		// Blank line = block separator
		if (!line.trim()) {
			flushAll();
			continue;
		}

		// Otherwise accumulate into current paragraph.
		flushListBuffer();
		flushQuoteBuffer();
		if (!paragraphBuffer) paragraphBuffer = [];
		paragraphBuffer.push(line);
	}

	flushCodeBlock();
	flushAll();

	return result;
};
