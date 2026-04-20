import { Moon, Sun } from "lucide-react";
import { useTheme } from "../contexts/ThemeContext";
import { IconButton } from "./ui/IconButton";

interface ThemeToggleProps {
	className?: string;
}

export default function ThemeToggle({ className = "" }: ThemeToggleProps) {
	const { theme, toggleTheme } = useTheme();
	const isDark = theme === "dark";

	return (
		<IconButton
			onClick={toggleTheme}
			title={isDark ? "Switch to light" : "Switch to dark"}
			aria-label="Toggle theme"
			className={className}
		>
			{isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
		</IconButton>
	);
}
