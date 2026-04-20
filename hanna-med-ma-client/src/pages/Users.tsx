import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { userService } from "../services/userService";
import type { User, CreateUserDto, UpdateUserDto } from "../types";
import Modal from "../components/Modal";
import { Button } from "../components/ui/Button";
import { Chip } from "../components/ui/Chip";

export default function Users() {
	const [users, setUsers] = useState<User[]>([]);
	const [loading, setLoading] = useState(true);
	const [isModalOpen, setIsModalOpen] = useState(false);
	const [editingUser, setEditingUser] = useState<User | null>(null);
	const [submitting, setSubmitting] = useState(false);
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
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setSubmitting(true);
		try {
			if (editingUser) {
				const updateData: UpdateUserDto = { ...formData };
				if (!updateData.password) delete updateData.password;
				await userService.update(editingUser.id, updateData);
			} else {
				await userService.create(formData);
			}
			await fetchUsers();
			handleCloseModal();
		} catch (error) {
			console.error("Error saving user:", error);
		} finally {
			setSubmitting(false);
		}
	};

	const handleDelete = async (id: number) => {
		if (!window.confirm("Delete this user?")) return;
		try {
			await userService.delete(id);
			await fetchUsers();
		} catch (error) {
			console.error("Error deleting user:", error);
		}
	};

	const initials = (name: string) =>
		name
			.split(" ")
			.map((p) => p[0])
			.filter(Boolean)
			.slice(0, 2)
			.join("")
			.toUpperCase();

	return (
		<div className="max-w-5xl">
			<div className="flex items-end justify-between gap-4 pb-4 mb-5 border-b border-n-150">
				<div>
					<div className="label-kicker mb-1.5">Administration</div>
					<div className="flex items-center gap-3">
						<h1 className="font-serif text-[24px] text-n-900 leading-tight">
							Users
						</h1>
						<Chip>{users.length}</Chip>
					</div>
					<p className="text-[12.5px] text-n-500 mt-1.5">
						Platform accounts with access to the admin dashboard.
					</p>
				</div>
				<Button
					tone="primary"
					size="sm"
					onClick={() => handleOpenModal()}
					leading={<Plus className="w-3.5 h-3.5" />}
				>
					Add user
				</Button>
			</div>

			<div className="border border-n-150 rounded-lg bg-n-0 overflow-hidden">
				<div className="grid grid-cols-[1fr_140px_110px_80px] px-4 h-10 border-b border-n-150 bg-n-50 items-center">
					<div className="label-kicker">User</div>
					<div className="label-kicker">Role</div>
					<div className="label-kicker">Username</div>
					<div className="label-kicker text-right">Actions</div>
				</div>

				{loading ? (
					<div className="flex items-center justify-center gap-2 py-10 text-n-500">
						<Loader2 className="w-4 h-4 animate-spin" />
						<span className="font-mono text-[11px] uppercase tracking-widest">
							Loading
						</span>
					</div>
				) : users.length === 0 ? (
					<div className="py-10 text-center font-mono text-[11.5px] text-n-500">
						No users yet.
					</div>
				) : (
					users.map((user) => (
						<div
							key={user.id}
							className="grid grid-cols-[1fr_140px_110px_80px] px-4 py-3 border-b border-n-150 last:border-0 items-center hover:bg-n-50 transition"
						>
							<div className="flex items-center gap-3 min-w-0">
								<div className="w-8 h-8 rounded-full bg-n-100 grid place-items-center font-mono text-[10.5px] text-n-700 shrink-0">
									{initials(user.name)}
								</div>
								<div className="min-w-0">
									<div className="text-[13.5px] font-medium text-n-900 truncate">
										{user.name}
									</div>
									<div className="font-mono text-[10.5px] text-n-500 truncate">
										{user.email}
									</div>
								</div>
							</div>
							<div>
								<Chip tone="primary">{user.rol}</Chip>
							</div>
							<div className="font-mono text-[11.5px] text-n-600 truncate">
								{user.username}
							</div>
							<div className="flex justify-end gap-0.5">
								<button
									onClick={() => handleOpenModal(user)}
									className="inline-flex items-center justify-center w-7 h-7 rounded-md text-n-500 hover:text-n-900 hover:bg-n-100 transition"
									title="Edit"
								>
									<Pencil className="w-3.5 h-3.5" />
								</button>
								<button
									onClick={() => handleDelete(user.id)}
									className="inline-flex items-center justify-center w-7 h-7 rounded-md text-n-500 hover:text-[var(--dnr-fg)] hover:bg-[var(--dnr-bg)] transition"
									title="Delete"
								>
									<Trash2 className="w-3.5 h-3.5" />
								</button>
							</div>
						</div>
					))
				)}
			</div>

			<Modal
				isOpen={isModalOpen}
				onClose={handleCloseModal}
				title={editingUser ? "Edit user" : "Add user"}
			>
				<form onSubmit={handleSubmit} className="space-y-4">
					<div>
						<label className="label-kicker block mb-1.5">Name</label>
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
						<label className="label-kicker block mb-1.5">Username</label>
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
						<label className="label-kicker block mb-1.5">Email</label>
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
						<label className="label-kicker block mb-1.5">Role</label>
						<input
							type="text"
							value={formData.rol}
							onChange={(e) =>
								setFormData({ ...formData, rol: e.target.value })
							}
							className="input-field"
							placeholder="admin · wp · user"
							required
						/>
					</div>
					<div>
						<label className="label-kicker block mb-1.5">
							Password{" "}
							{editingUser && (
								<span className="normal-case tracking-normal font-sans text-n-400">
									· leave empty to keep current
								</span>
							)}
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

					<div className="flex gap-2 pt-2">
						<Button
							type="button"
							tone="ghost"
							size="md"
							onClick={handleCloseModal}
							className="flex-1"
						>
							Cancel
						</Button>
						<Button
							type="submit"
							tone="primary"
							size="md"
							disabled={submitting}
							className="flex-1"
						>
							{submitting ? (
								<>
									<Loader2 className="w-4 h-4 animate-spin" />
									<span>Saving…</span>
								</>
							) : editingUser ? (
								"Update"
							) : (
								"Create"
							)}
						</Button>
					</div>
				</form>
			</Modal>
		</div>
	);
}
