import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { userService } from "../services/userService";
import type { User, CreateUserDto, UpdateUserDto } from "../types";
import Modal from "../components/Modal";

export default function Users() {
	const [users, setUsers] = useState<User[]>([]);
	const [loading, setLoading] = useState(true);
	const [isModalOpen, setIsModalOpen] = useState(false);
	const [editingUser, setEditingUser] = useState<User | null>(null);
	const [formData, setFormData] = useState<CreateUserDto>({
		name: "",
		rol: "",
		username: "",
		password: "",
		email: "",
	});

	useEffect(() => {
		fetchUsers();
	}, []);

	const fetchUsers = async () => {
		try {
			const data = await userService.getAll();
			setUsers(data);
		} catch (error) {
			console.error("Error fetching users:", error);
		} finally {
			setLoading(false);
		}
	};

	const handleOpenModal = (user?: User) => {
		if (user) {
			setEditingUser(user);
			setFormData({
				name: user.name,
				rol: user.rol,
				username: user.username,
				password: "",
				email: user.email,
			});
		} else {
			setEditingUser(null);
			setFormData({
				name: "",
				rol: "",
				username: "",
				password: "",
				email: "",
			});
		}
		setIsModalOpen(true);
	};

	const handleCloseModal = () => {
		setIsModalOpen(false);
		setEditingUser(null);
		setFormData({
			name: "",
			rol: "",
			username: "",
			password: "",
			email: "",
		});
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		try {
			if (editingUser) {
				const updateData: UpdateUserDto = { ...formData };
				if (!updateData.password) {
					delete updateData.password;
				}
				await userService.update(editingUser.id, updateData);
			} else {
				await userService.create(formData);
			}
			await fetchUsers();
			handleCloseModal();
		} catch (error) {
			console.error("Error saving user:", error);
			alert("Error saving user");
		}
	};

	const handleDelete = async (id: number) => {
		if (window.confirm("Are you sure you want to delete this user?")) {
			try {
				await userService.delete(id);
				await fetchUsers();
			} catch (error) {
				console.error("Error deleting user:", error);
				alert("Error deleting user");
			}
		}
	};

	if (loading) {
		return (
			<div className="flex items-center justify-center h-64">
				<div className="text-gray-600">Loading...</div>
			</div>
		);
	}

	return (
		<div>
			<div className="flex justify-between items-center mb-4">
				<div>
					<h1 className="text-xl font-bold text-gray-900 dark:text-white">
						Users Management
					</h1>
					<p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
						Manage system users
					</p>
				</div>
				<button
					onClick={() => handleOpenModal()}
					className="btn-primary flex items-center gap-2"
				>
					<Plus className="w-4 h-4" />
					Add User
				</button>
			</div>

			<div className="card">
				<div className="overflow-x-auto">
					<table className="w-full">
						<thead>
							<tr className="border-b border-gray-200 dark:border-slate-700">
								<th className="text-left py-2 px-3 text-xs font-semibold text-gray-700 dark:text-gray-300">
									Name
								</th>
								<th className="text-left py-2 px-3 text-xs font-semibold text-gray-700 dark:text-gray-300">
									Username
								</th>
								<th className="text-left py-2 px-3 text-xs font-semibold text-gray-700 dark:text-gray-300">
									Email
								</th>
								<th className="text-left py-2 px-3 text-xs font-semibold text-gray-700 dark:text-gray-300">
									Role
								</th>
								<th className="text-right py-2 px-3 text-xs font-semibold text-gray-700 dark:text-gray-300">
									Actions
								</th>
							</tr>
						</thead>
						<tbody>
							{users.map((user) => (
								<tr
									key={user.id}
									className="border-b border-gray-100 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700/50"
								>
									<td className="py-2 px-3 text-sm font-medium dark:text-white">
										{user.name}
									</td>
									<td className="py-2 px-3 text-xs text-gray-600 dark:text-gray-400">
										{user.username}
									</td>
									<td className="py-2 px-3 text-xs text-gray-600 dark:text-gray-400">
										{user.email}
									</td>
									<td className="py-2 px-3">
										<span className="px-2 py-0.5 bg-primary/10 dark:bg-primary/20 text-primary dark:text-primary-200 rounded-full text-xs">
											{user.rol}
										</span>
									</td>
									<td className="py-2 px-3">
										<div className="flex justify-end gap-1">
											<button
												onClick={() => handleOpenModal(user)}
												className="p-1.5 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors"
											>
												<Pencil className="w-3.5 h-3.5" />
											</button>
											<button
												onClick={() => handleDelete(user.id)}
												className="p-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors"
											>
												<Trash2 className="w-3.5 h-3.5" />
											</button>
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
					{users.length === 0 && (
						<div className="text-center py-8 text-gray-500">No users found</div>
					)}
				</div>
			</div>

			<Modal
				isOpen={isModalOpen}
				onClose={handleCloseModal}
				title={editingUser ? "Edit User" : "Add New User"}
			>
				<form onSubmit={handleSubmit} className="space-y-4">
					<div>
						<label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
							Name
						</label>
						<input
							type="text"
							value={formData.name}
							onChange={(e) =>
								setFormData({ ...formData, name: e.target.value })
							}
							className="input-field"
							required
						/>
					</div>

					<div>
						<label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
							Username
						</label>
						<input
							type="text"
							value={formData.username}
							onChange={(e) =>
								setFormData({ ...formData, username: e.target.value })
							}
							className="input-field"
							required
						/>
					</div>

					<div>
						<label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
							Email
						</label>
						<input
							type="email"
							value={formData.email}
							onChange={(e) =>
								setFormData({ ...formData, email: e.target.value })
							}
							className="input-field"
							required
						/>
					</div>

					<div>
						<label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
							Role
						</label>
						<input
							type="text"
							value={formData.rol}
							onChange={(e) =>
								setFormData({ ...formData, rol: e.target.value })
							}
							className="input-field"
							placeholder="e.g., admin, wp, user"
							required
						/>
					</div>

					<div>
						<label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
							Password {editingUser && "(leave empty to keep current)"}
						</label>
						<input
							type="password"
							value={formData.password}
							onChange={(e) =>
								setFormData({ ...formData, password: e.target.value })
							}
							className="input-field"
							required={!editingUser}
						/>
					</div>

					<div className="flex gap-3 pt-4">
						<button
							type="button"
							onClick={handleCloseModal}
							className="btn-secondary flex-1"
						>
							Cancel
						</button>
						<button type="submit" className="btn-primary flex-1">
							{editingUser ? "Update" : "Create"}
						</button>
					</div>
				</form>
			</Modal>
		</div>
	);
}
