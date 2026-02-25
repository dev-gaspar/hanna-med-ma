import { Moon, Sun } from "lucide-react";
import { useTheme } from "../contexts/ThemeContext";

interface ThemeToggleProps {
	className?: string;
}

export default function ThemeToggle({ className = "" }: ThemeToggleProps) {
	const { theme, toggleTheme } = useTheme();

	return (
		<button
			onClick={toggleTheme}
			className={`p-2 rounded-lg transition-all duration-300 ${
				theme === "dark"
					? "bg-slate-700 hover:bg-slate-600 text-yellow-400"
					: "bg-slate-200 hover:bg-slate-300 text-slate-700"
			} ${className}`}
			title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
			aria-label="Toggle theme"
		>
			{theme === "dark" ? (
				<Sun className="w-5 h-5" />
			) : (
				<Moon className="w-5 h-5" />
			)}
		</button>
	);
}
