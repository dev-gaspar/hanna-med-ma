import { Users, Stethoscope, Activity, ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { userService } from "../services/userService";
import { doctorService } from "../services/doctorService";
import { Chip } from "../components/ui/Chip";

export default function Dashboard() {
	const [stats, setStats] = useState({
		users: 0,
		doctors: 0,
	});
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		const fetchStats = async () => {
			try {
				const [users, doctors] = await Promise.all([
					userService.getAll(),
					doctorService.getAll(),
				]);
				setStats({
					users: users.length,
					doctors: doctors.length,
				});
			} catch (error) {
				console.error("Error fetching stats:", error);
			} finally {
				setLoading(false);
			}
		};

		fetchStats();
	}, []);

	const statCards = [
		{
			title: "Total users",
			value: stats.users,
			trend: loading ? "loading" : "ok",
		},
		{
			title: "Total doctors",
			value: stats.doctors,
			trend: loading ? "loading" : "ok",
		},
		{
			title: "System status",
			value: "Active",
			trend: "ok" as const,
		},
	];

	const quickActions = [
		{
			title: "Manage users",
			description: "Invite, suspend, and assign roles",
			href: "/admin/dashboard/users",
			icon: Users,
		},
		{
			title: "Manage doctors",
			description: "EMR assignments and census access",
			href: "/admin/dashboard/doctors",
			icon: Stethoscope,
		},
	];

	return (
		<div className="max-w-5xl">
			<div className="flex items-end justify-between gap-4 pb-4 mb-5 border-b border-n-150">
				<div>
					<div className="label-kicker mb-1.5">Operations</div>
					<h1 className="font-serif text-[26px] text-n-900 leading-tight">
						Dashboard
					</h1>
					<p className="text-[13px] text-n-500 mt-1.5">
						Welcome to Hanna-Med · Admin
					</p>
				</div>
				<Chip tone="ok">system healthy</Chip>
			</div>

			<div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
				{statCards.map((stat) => (
					<div
						key={stat.title}
						className="border border-n-150 rounded-lg bg-n-0 p-4"
					>
						<div className="label-kicker">{stat.title}</div>
						<div className="font-serif text-[32px] text-n-900 tabular-nums mt-1 leading-none">
							{stat.value}
						</div>
						<div className="mt-2 font-mono text-[11px] text-n-500 flex items-center gap-1.5">
							<Activity className="w-3 h-3" />
							<span>live</span>
						</div>
					</div>
				))}
			</div>

			<div className="mb-3">
				<div className="label-kicker mb-2">Quick actions</div>
			</div>
			<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
				{quickActions.map((action) => {
					const Icon = action.icon;
					return (
						<Link
							key={action.href}
							to={action.href}
							className="group border border-n-150 rounded-lg bg-n-0 p-4 hover:border-n-200 hover:bg-n-50 transition flex items-center gap-4"
						>
							<div className="w-10 h-10 rounded-md bg-p-50 grid place-items-center shrink-0">
								<Icon className="w-5 h-5 text-p-600" />
							</div>
							<div className="flex-1 min-w-0">
								<div className="font-semibold text-n-900 text-[14px]">
									{action.title}
								</div>
								<div className="text-[12.5px] text-n-500 mt-0.5">
									{action.description}
								</div>
							</div>
							<ArrowRight className="w-4 h-4 text-n-400 group-hover:text-n-700 transition shrink-0" />
						</Link>
					);
				})}
			</div>
		</div>
	);
}
