import { Users, Stethoscope, Activity } from "lucide-react";
import { useEffect, useState } from "react";
import { userService } from "../services/userService";
import { doctorService } from "../services/doctorService";

export default function Dashboard() {
	const [stats, setStats] = useState({
		users: 0,
		doctors: 0,
	});

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
			}
		};

		fetchStats();
	}, []);

	const statCards = [
		{
			title: "Total Users",
			value: stats.users,
			icon: Users,
			color: "bg-blue-500",
		},
		{
			title: "Total Doctors",
			value: stats.doctors,
			icon: Stethoscope,
			color: "bg-primary",
		},
		{
			title: "System Status",
			value: "Active",
			icon: Activity,
			color: "bg-green-500",
		},
	];

	return (
		<div>
			<div className="mb-4">
				<h1 className="text-xl font-bold text-gray-900 dark:text-white">
					Dashboard
				</h1>
				<p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
					Welcome to Hanna-Med MA Dashboard
				</p>
			</div>

			{/* Stats Grid */}
			<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
				{statCards.map((stat) => {
					const Icon = stat.icon;
					return (
						<div key={stat.title} className="card">
							<div className="flex items-center justify-between">
								<div>
									<p className="text-xs font-medium text-gray-600 dark:text-gray-400">
										{stat.title}
									</p>
									<p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
										{stat.value}
									</p>
								</div>
								<div className={`${stat.color} p-3 rounded-full`}>
									<Icon className="w-6 h-6 text-white" />
								</div>
							</div>
						</div>
					);
				})}
			</div>

			{/* Quick Actions */}
			<div className="mt-5">
				<h2 className="text-base font-bold text-gray-900 dark:text-white mb-3">
					Quick Actions
				</h2>
				<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
					<a
						href="/admin/dashboard/users"
						className="card hover:shadow-md transition-shadow cursor-pointer"
					>
						<div className="flex items-center gap-4">
							<div className="bg-primary/10 dark:bg-primary/20 p-3 rounded-lg">
								<Users className="w-6 h-6 text-primary" />
							</div>
							<div>
								<h3 className="font-semibold text-gray-900 dark:text-white">
									Manage Users
								</h3>
								<p className="text-sm text-gray-600 dark:text-gray-400">
									View and manage system users
								</p>
							</div>
						</div>
					</a>

					<a
						href="/admin/dashboard/doctors"
						className="card hover:shadow-md transition-shadow cursor-pointer"
					>
						<div className="flex items-center gap-4">
							<div className="bg-primary/10 dark:bg-primary/20 p-3 rounded-lg">
								<Stethoscope className="w-6 h-6 text-primary" />
							</div>
							<div>
								<h3 className="font-semibold text-gray-900 dark:text-white">
									Manage Doctors
								</h3>
								<p className="text-sm text-gray-600 dark:text-gray-400">
									View and manage doctors
								</p>
							</div>
						</div>
					</a>
				</div>
			</div>
		</div>
	);
}
