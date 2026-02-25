import React from "react";

/**
 * Parse inline formatting: *bold*, _italic_, ~strikethrough~, `code`
 * Recursive to support nested styles like bold-italic.
 */
export const parseInlineFormatting = (text: string): React.ReactNode[] => {
	const result: React.ReactNode[] = [];
	let remaining = text;
	let keyIndex = 0;

	// Pattern order matters: check longer patterns first
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
					className="bg-slate-200 dark:bg-slate-600 px-1.5 py-0.5 rounded text-xs font-mono"
				>
					{content}
				</code>
			),
		},
		// Bold: *text*
		{
			regex: /\*([^*]+)\*/,
			render: (_, content) => (
				<strong key={`bold-${keyIndex++}`} className="font-bold">
					{parseInlineFormatting(content)}
				</strong>
			),
		},
		// Italic: _text_
		{
			regex: /_([^_]+)_/,
			render: (_, content) => (
				<em key={`italic-${keyIndex++}`} className="italic">
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
			// Add text before match
			if (earliestMatch.index > 0) {
				result.push(remaining.slice(0, earliestMatch.index));
			}
			// Add formatted element
			result.push(
				earliestMatch.pattern.render(
					earliestMatch.match[0],
					earliestMatch.match[1],
				),
			);
			// Continue with remaining text
			remaining = remaining.slice(
				earliestMatch.index + earliestMatch.match[0].length,
			);
		} else {
			// No more matches
			result.push(remaining);
			break;
		}
	}

	return result;
};

/**
 * Parse WhatsApp-style formatting into React elements
 * Supports: *bold*, _italic_, ~strikethrough~, `code`, ```monospace```, lists, quotes
 */
export const parseWhatsAppFormat = (text: string): React.ReactNode[] => {
	const lines = text.split("\n");
	const result: React.ReactNode[] = [];
	let listBuffer: { type: "bullet" | "numbered"; items: string[] } | null =
		null;
	let codeBlockBuffer: string[] | null = null;
	let quoteBuffer: string[] | null = null;
	let lineKey = 0;

	const flushListBuffer = () => {
		if (listBuffer) {
			const ListTag = listBuffer.type === "numbered" ? "ol" : "ul";
			result.push(
				<ListTag
					key={`list-${lineKey}`}
					className={`${listBuffer.type === "numbered" ? "list-decimal" : "list-disc"} ml-4 my-2`}
				>
					{listBuffer.items.map((item, i) => (
						<li key={i} className="mb-1">
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
			result.push(
				<blockquote
					key={`quote-${lineKey}`}
					className="border-l-4 border-slate-400 dark:border-slate-500 pl-3 my-2 italic text-slate-600 dark:text-slate-300"
				>
					{quoteBuffer.map((line, i) => (
						<span key={i}>
							{parseInlineFormatting(line)}
							{i < quoteBuffer!.length - 1 && <br />}
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
					className="bg-slate-800 dark:bg-slate-900 text-green-400 p-3 rounded-lg my-2 overflow-x-auto font-mono text-xs"
				>
					<code>{codeBlockBuffer.join("\n")}</code>
				</pre>,
			);
			codeBlockBuffer = null;
		}
	};

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		lineKey = i;

		// Code block handling (```)
		if (line.trim().startsWith("```")) {
			if (codeBlockBuffer === null) {
				flushListBuffer();
				flushQuoteBuffer();
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

		// Bullet list: * item or - item
		const bulletMatch = line.match(/^[\*\-]\s+(.+)$/);
		if (bulletMatch) {
			flushQuoteBuffer();
			if (listBuffer?.type !== "bullet") {
				flushListBuffer();
				listBuffer = { type: "bullet", items: [] };
			}
			listBuffer.items.push(bulletMatch[1]);
			continue;
		}

		// Numbered list: 1. item
		const numberedMatch = line.match(/^\d+\.\s+(.+)$/);
		if (numberedMatch) {
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
			flushListBuffer();
			if (!quoteBuffer) {
				quoteBuffer = [];
			}
			quoteBuffer.push(quoteMatch[1]);
			continue;
		}

		// Flush any pending buffers
		flushListBuffer();
		flushQuoteBuffer();

		// Regular line with inline formatting
		if (line.trim()) {
			result.push(
				<span key={`line-${i}`}>
					{parseInlineFormatting(line)}
					{i < lines.length - 1 && <br />}
				</span>,
			);
		} else if (i < lines.length - 1) {
			result.push(<br key={`br-${i}`} />);
		}
	}

	// Flush remaining buffers
	flushCodeBlock();
	flushListBuffer();
	flushQuoteBuffer();

	return result;
};
