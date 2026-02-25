export const ChatSkeleton = () => (
	<div className="space-y-5 p-4 animate-pulse w-full h-full">
		<div className="flex justify-end">
			<div className="w-48 h-10 bg-slate-200/60 dark:bg-slate-800 rounded-2xl" />
		</div>
		<div className="flex gap-2">
			<div className="w-6 h-6 md:w-7 md:h-7 bg-slate-200/60 dark:bg-slate-800 rounded-full shrink-0" />
			<div className="w-full max-w-sm h-20 bg-slate-200/60 dark:bg-slate-800 rounded-2xl" />
		</div>
		<div className="flex justify-end">
			<div className="w-36 h-9 bg-slate-200/60 dark:bg-slate-800 rounded-2xl" />
		</div>
		<div className="flex gap-2">
			<div className="w-6 h-6 md:w-7 md:h-7 bg-slate-200/60 dark:bg-slate-800 rounded-full shrink-0" />
			<div className="w-full max-w-xs h-14 bg-slate-200/60 dark:bg-slate-800 rounded-2xl" />
		</div>
	</div>
);
