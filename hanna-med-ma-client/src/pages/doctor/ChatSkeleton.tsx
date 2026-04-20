export const ChatSkeleton = () => (
	<div className="space-y-5 p-4 animate-pulse w-full h-full">
		<div className="flex justify-end">
			<div className="w-48 h-10 bg-n-100 rounded-lg" />
		</div>
		<div className="space-y-2 max-w-[88%]">
			<div className="h-3 w-40 bg-n-100 rounded" />
			<div className="h-24 bg-n-100 rounded-lg" />
		</div>
		<div className="flex justify-end">
			<div className="w-36 h-9 bg-n-100 rounded-lg" />
		</div>
		<div className="space-y-2 max-w-[70%]">
			<div className="h-3 w-32 bg-n-100 rounded" />
			<div className="h-14 bg-n-100 rounded-lg" />
		</div>
	</div>
);
