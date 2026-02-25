import { Link } from "react-router-dom";
import {
	Sparkles,
	Shield,
	Stethoscope,
	MessageSquare,
	Activity,
	Clock,
	ArrowRight,
} from "lucide-react";

const features = [
	{
		icon: MessageSquare,
		title: "AI Chat Assistant",
		description:
			"Natural language interface for patient queries and clinical support.",
		color: "bg-blue-500",
	},
	{
		icon: Stethoscope,
		title: "EMR Integration",
		description:
			"Seamless connection with your existing electronic medical records.",
		color: "bg-purple-500",
	},
	{
		icon: Activity,
		title: "Patient Summaries",
		description: "Quick AI-generated summaries of patient history and status.",
		color: "bg-green-500",
	},
	{
		icon: Shield,
		title: "HIPAA Compliant",
		description: "Enterprise-grade security with full HIPAA compliance.",
		color: "bg-cyan-500",
	},
];

const benefits = [
	"Reduce administrative workload by 60%",
	"Instant patient data lookups",
	"24/7 AI-powered assistance",
	"Secure and encrypted communications",
];

export default function LandingPage() {
	return (
		<div className="min-h-screen bg-white dark:bg-slate-900">
			{/* Navbar */}
			<nav className="fixed top-0 w-full bg-white/80 dark:bg-slate-900/80 backdrop-blur-lg border-b border-gray-100 dark:border-slate-800 z-50">
				<div className="max-w-5xl mx-auto px-4 flex items-center justify-between h-16">
					<div className="flex items-center gap-3">
						<div className="w-8 h-8 bg-primary rounded-xl flex items-center justify-center shadow-lg shadow-primary/20">
							<Stethoscope className="w-5 h-5 text-white" />
						</div>
						<span className="text-sm font-bold text-gray-900 dark:text-white">
							Hanna-Med MA
						</span>
					</div>
					<div className="flex items-center gap-2">
						<Link
							to="/doctor/login"
							className="text-xs text-gray-600 dark:text-gray-400 hover:text-primary transition-colors"
						>
							Doctor Portal
						</Link>
					</div>
				</div>
			</nav>

			{/* Hero */}
			<section className="pt-28 pb-12 md:pt-32 md:pb-16 bg-gradient-to-br from-slate-50 via-white to-blue-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900">
				<div className="max-w-3xl mx-auto px-4 text-center">
					<div className="inline-flex items-center px-3 py-1 bg-primary/10 rounded-full text-primary text-xs font-medium mb-4">
						<Sparkles className="w-3 h-3 mr-1.5" /> AI-Powered Medical Assistant
					</div>
					<h1 className="text-3xl md:text-5xl font-bold text-gray-900 dark:text-white mb-3 leading-tight">
						Intelligent Medical
						<span className="text-primary"> Management</span>
					</h1>
					<p className="text-sm md:text-base text-gray-600 dark:text-gray-400 mb-6 max-w-xl mx-auto">
						Streamline your clinical workflow with AI-powered patient summaries,
						real-time insights, and seamless EMR integration.
					</p>
					<div className="flex flex-col sm:flex-row gap-3 justify-center">
						<Link
							to="/doctor/login"
							className="btn-primary px-5 py-2.5 text-center inline-flex items-center justify-center gap-2"
						>
							Access Portal <ArrowRight className="w-4 h-4" />
						</Link>
					</div>

					{/* Trust badges */}
					<div className="mt-8 flex flex-wrap justify-center gap-6 text-xs text-gray-500 dark:text-gray-400">
						<div className="flex items-center gap-1.5">
							<Shield className="w-3.5 h-3.5 text-green-500" />
							<span>HIPAA Compliant</span>
						</div>
						<div className="flex items-center gap-1.5">
							<Sparkles className="w-3.5 h-3.5 text-yellow-500" />
							<span>AI-Powered</span>
						</div>
						<div className="flex items-center gap-1.5">
							<Clock className="w-3.5 h-3.5 text-blue-500" />
							<span>24/7 Available</span>
						</div>
					</div>
				</div>
			</section>

			{/* Features */}
			<section className="py-12 md:py-16 bg-white dark:bg-slate-900">
				<div className="max-w-5xl mx-auto px-4">
					<div className="text-center mb-8">
						<h2 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white mb-2">
							Key Features
						</h2>
						<p className="text-sm text-gray-600 dark:text-gray-400 max-w-lg mx-auto">
							Powerful features designed to enhance your clinical practice.
						</p>
					</div>
					<div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
						{features.map((feature, index) => {
							const Icon = feature.icon;
							return (
								<div
									key={index}
									className="card hover:shadow-md transition-shadow"
								>
									<div
										className={`w-10 h-10 ${feature.color} rounded-lg flex items-center justify-center mb-3`}
									>
										<Icon className="w-5 h-5 text-white" />
									</div>
									<h3 className="text-sm font-bold text-gray-900 dark:text-white mb-1">
										{feature.title}
									</h3>
									<p className="text-xs text-gray-600 dark:text-gray-400">
										{feature.description}
									</p>
								</div>
							);
						})}
					</div>
				</div>
			</section>

			{/* Benefits */}
			<section className="py-12 md:py-16 bg-gradient-to-br from-primary to-blue-600">
				<div className="max-w-3xl mx-auto px-4 text-center">
					<h2 className="text-2xl md:text-3xl font-bold text-white mb-3">
						Transform Your Clinical Workflow
					</h2>
					<p className="text-sm text-blue-100 mb-6 max-w-lg mx-auto">
						Join physicians who have streamlined their workflow with Hanna-Med.
					</p>
					<div className="grid sm:grid-cols-2 gap-3 max-w-md mx-auto text-left">
						{benefits.map((benefit, index) => (
							<div key={index} className="flex items-center gap-2">
								<Shield className="w-3.5 h-3.5 text-cyan-300 flex-shrink-0" />
								<span className="text-sm text-white">{benefit}</span>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* CTA */}
			<section className="py-12 md:py-16 bg-background-secondary dark:bg-slate-800">
				<div className="max-w-3xl mx-auto px-4 text-center">
					<h2 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white mb-3">
						Ready to Get Started?
					</h2>
					<p className="text-sm text-gray-600 dark:text-gray-400 mb-5 max-w-lg mx-auto">
						Start using Hanna-Med today and experience the future of clinical
						workflow management.
					</p>
					<div className="flex flex-col sm:flex-row gap-3 justify-center">
						<Link
							to="/doctor/login"
							className="btn-primary px-6 py-2.5 text-center"
						>
							Start Now
						</Link>
					</div>
				</div>
			</section>

			{/* Footer */}
			<footer className="py-6 border-t border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900">
				<div className="max-w-5xl mx-auto px-4 text-center">
					<p className="text-xs text-gray-500 dark:text-gray-400">
						© {new Date().getFullYear()} Hanna-Med MA. All rights reserved.
						HIPAA Compliant.
					</p>
					<div className="mt-2">
						<Link
							to="/admin/login"
							className="text-[10px] text-gray-400 dark:text-gray-600 hover:text-gray-600 dark:hover:text-gray-400 transition-colors"
						>
							Admin Access
						</Link>
					</div>
				</div>
			</footer>
		</div>
	);
}
