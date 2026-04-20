import { Link } from "react-router-dom";
import { ArrowRight, Lock, Play, Shield, Sparkles } from "lucide-react";
import { Button } from "../components/ui/Button";
import ThemeToggle from "../components/ThemeToggle";

const features = [
	{
		kicker: "01 · Your census",
		title: "Every patient, every hospital, in one place.",
		body: "Your daily list across every hospital you cover refreshes on its own — no logging in, no clicking through charts.",
	},
	{
		kicker: "02 · Ask anything",
		title: "A clinical assistant that knows your patients.",
		body: "Ask about a patient's summary, insurance or labs in plain language. Answers come from the actual chart, not a guess.",
	},
	{
		kicker: "03 · One tap, seen",
		title: "Mark a visit done, the rest runs itself.",
		body: "Tap seen, pick consult or follow-up, pick the date. The note is collected in the background so billing can move.",
	},
];

export default function LandingPage() {
	return (
		<div className="min-h-screen bg-n-0 text-n-900">
			{/* Top nav */}
			<nav className="h-14 px-6 border-b border-n-150 bg-n-0 flex items-center justify-between">
				<Link to="/" className="flex items-center gap-2">
					<div className="w-7 h-7 rounded bg-p-700 grid place-items-center font-serif text-white text-[13px]">
						H
					</div>
					<span className="font-serif text-[15px] text-n-900">Hanna-Med</span>
				</Link>
				<div className="flex items-center gap-2">
					<ThemeToggle />
					<Link to="/doctor/login">
						<Button tone="primary" size="sm">
							Sign in
						</Button>
					</Link>
				</div>
			</nav>

			{/* Hero */}
			<section className="border-b border-n-150">
				<div className="max-w-5xl mx-auto px-6 py-16 md:py-24 grid md:grid-cols-[1.15fr_1fr] gap-10 items-start">
					<div>
						<div className="font-mono text-[10.5px] uppercase tracking-widest text-n-500 mb-5">
							Medical assistant · multi-hospital
						</div>
						<h1
							className="font-serif text-[36px] md:text-[52px] leading-[1.05] tracking-tight text-n-900 mb-5"
							style={{ textWrap: "pretty" as any }}
						>
							The charting your hospital does,{" "}
							<span className="text-n-500 italic">without</span> the charting.
						</h1>
						<p className="text-[14.5px] text-n-700 leading-[1.65] max-w-lg mb-7">
							Hanna-Med rounds with you. Pulls your census, reads the notes,
							keeps the record — so the visit can stay about the patient.
						</p>
						<div className="flex flex-wrap gap-2">
							<Link to="/doctor/login">
								<Button
									tone="primary"
									size="lg"
									trailing={<ArrowRight className="w-4 h-4" />}
								>
									Open the portal
								</Button>
							</Link>
							<Button
								tone="ghost"
								size="lg"
								leading={<Play className="w-3.5 h-3.5" />}
							>
								Watch the demo
							</Button>
						</div>
						<div className="mt-10 pt-6 border-t border-n-150 flex flex-wrap items-center gap-5 text-[10.5px] font-mono text-n-500 uppercase tracking-widest">
							<span className="flex items-center gap-1.5">
								<Lock className="w-3 h-3" />
								HIPAA compliant
							</span>
							<span className="flex items-center gap-1.5">
								<Shield className="w-3 h-3" />
								Private &amp; encrypted
							</span>
							<span className="flex items-center gap-1.5">
								<Sparkles className="w-3 h-3" />
								Built with doctors
							</span>
						</div>
					</div>

					{/* Visual: neutral census mock */}
					<div className="bg-n-50 border border-n-150 rounded-lg p-6 relative overflow-hidden">
						<div
							className="absolute inset-0 opacity-[0.04] pointer-events-none"
							style={{
								backgroundImage:
									"linear-gradient(var(--n-900) 1px, transparent 1px), linear-gradient(90deg, var(--n-900) 1px, transparent 1px)",
								backgroundSize: "24px 24px",
							}}
						/>
						<div className="relative bg-n-0 rounded-lg border border-n-150 shadow-pop overflow-hidden">
							<div className="px-4 h-10 border-b border-n-150 flex items-center justify-between">
								<div className="font-mono text-[10.5px] uppercase tracking-widest text-n-600">
									Baptist · 8th · today
								</div>
								<span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--ok-fg)]">
									<span className="w-1.5 h-1.5 rounded-full bg-[var(--ok-fg)]" />
									synced
								</span>
							</div>
							{[
								{
									name: "Bayona, Arturo N.",
									meta: "rm 214 · non-healing ulcer",
									tag: "unseen",
								},
								{
									name: "Reyes, Maria",
									meta: "rm 208 · diabetes f/u",
									tag: "seen",
								},
								{
									name: "Kim, Daniel",
									meta: "rm 216 · cellulitis",
									tag: "unseen",
								},
								{
									name: "Valdés, Esther",
									meta: "rm 203 · neuropathy",
									tag: "seen",
								},
								{
									name: "Ortiz, Samuel",
									meta: "rm 221 · osteomyelitis r/o",
									tag: "unseen",
								},
							].map((p, i) => (
								<div
									key={i}
									className={`px-4 py-3 border-b border-n-150 last:border-0 flex items-center gap-3 text-[12.5px] ${
										i === 2 ? "bg-p-50" : ""
									}`}
								>
									<div className="flex-1 min-w-0">
										<div className="font-medium text-n-900 truncate">
											{p.name}
										</div>
										<div className="font-mono text-[10.5px] text-n-500 mt-0.5 truncate">
											{p.meta}
										</div>
									</div>
									{p.tag === "seen" ? (
										<span className="inline-flex items-center px-2 py-[3px] rounded bg-[var(--ok-bg)] text-[var(--ok-fg)] text-[10px] uppercase tracking-wider font-mono">
											seen
										</span>
									) : (
										<span className="inline-flex items-center px-2 py-[3px] rounded bg-n-100 text-n-700 text-[10px] uppercase tracking-wider font-mono">
											unseen
										</span>
									)}
								</div>
							))}
						</div>
					</div>
				</div>
			</section>

			{/* Features */}
			<section>
				<div className="max-w-5xl mx-auto grid md:grid-cols-3 border-b border-n-150">
					{features.map((f, i) => (
						<div
							key={i}
							className={`p-8 ${i < 2 ? "md:border-r border-n-150" : ""} ${i > 0 ? "border-t md:border-t-0 border-n-150" : ""}`}
						>
							<div className="font-mono text-[10.5px] uppercase tracking-widest text-n-500 mb-3">
								{f.kicker}
							</div>
							<div
								className="font-serif text-[22px] text-n-900 tracking-tight mb-3"
								style={{ textWrap: "pretty" as any }}
							>
								{f.title}
							</div>
							<div className="text-[13px] text-n-600 leading-[1.65]">
								{f.body}
							</div>
						</div>
					))}
				</div>
			</section>

			{/* Value strip — speaks to the doctor, not the engineer */}
			<section className="max-w-5xl mx-auto px-6 py-14">
				<div className="grid md:grid-cols-[1fr_1.1fr] gap-10 items-start">
					<div>
						<div className="font-mono text-[10.5px] uppercase tracking-widest text-n-500 mb-4">
							What it does for you
						</div>
						<h3
							className="font-serif text-[22px] md:text-[26px] text-n-900 tracking-tight leading-[1.25] max-w-md"
							style={{ textWrap: "pretty" as any }}
						>
							Less time logging in. More time with the patient.
						</h3>
						<p className="text-[13.5px] text-n-700 leading-[1.7] mt-4 max-w-md">
							Hanna-Med keeps the record up to date in the background. Open the
							app and your list for the day is ready, your notes are tracked, and
							the assistant answers any question you have in seconds.
						</p>
					</div>
					<div className="border border-n-150 rounded-lg bg-n-50 p-6">
						<div className="font-mono text-[10.5px] uppercase tracking-widest text-n-500 mb-4">
							Built for the daily round
						</div>
						<div className="grid grid-cols-3 gap-5">
							<div>
								<div className="font-serif text-[32px] text-n-900 leading-none">
									Zero
								</div>
								<div className="text-[11.5px] text-n-600 mt-2 leading-[1.55]">
									extra EMR logins per morning
								</div>
							</div>
							<div>
								<div className="font-serif text-[32px] text-n-900 leading-none">
									One tap
								</div>
								<div className="text-[11.5px] text-n-600 mt-2 leading-[1.55]">
									to mark a patient as seen
								</div>
							</div>
							<div>
								<div className="font-serif text-[32px] text-n-900 leading-none">
									24/7
								</div>
								<div className="text-[11.5px] text-n-600 mt-2 leading-[1.55]">
									assistant ready for clinical questions
								</div>
							</div>
						</div>
					</div>
				</div>
			</section>

			{/* Footer */}
			<footer className="border-t border-n-150">
				<div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
					<div className="font-mono text-[10.5px] text-n-500">
						© {new Date().getFullYear()} Hanna-Med · Miami, FL
					</div>
					<Link
						to="/admin/login"
						className="font-mono text-[10.5px] text-n-500 hover:text-n-900 transition"
					>
						Admin access
					</Link>
				</div>
			</footer>
		</div>
	);
}
