"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useDeckStore } from "@/store/deckStore";

const tabs = [
  { href: "/randomizer", label: "Randomizer", icon: DiceIcon },
  { href: "/settings", label: "Settings", icon: GearIcon },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="absolute bottom-0 left-0 right-0 z-50 border-t border-neutral-800 bg-neutral-900">
      <div className="flex h-12 divide-x divide-neutral-800">
        {tabs.map((tab) => {
          const isActive =
            pathname === tab.href || pathname.startsWith(tab.href + "/");
          return (
            <Link
              key={tab.href}
              href={tab.href}
              onClick={(e) => {
                // Tapping the active randomizer tab returns to filters
                if (isActive && tab.href === "/randomizer" && useDeckStore.getState().view !== "filters") {
                  e.preventDefault();
                  useDeckStore.getState().clear();
                }
              }}
              className={`flex flex-1 items-center justify-center transition-colors ${
                isActive
                  ? "bg-white/5 text-neutral-300"
                  : "text-neutral-500 hover:text-neutral-300"
              }`}
            >
              <tab.icon active={isActive} />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function DiceIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke={active ? "currentColor" : "currentColor"}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="2" width="20" height="20" rx="3" />
      <circle cx="8" cy="8" r="1.5" fill="currentColor" />
      <circle cx="16" cy="8" r="1.5" fill="currentColor" />
      <circle cx="8" cy="16" r="1.5" fill="currentColor" />
      <circle cx="16" cy="16" r="1.5" fill="currentColor" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </svg>
  );
}

function GearIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 472.615 472.615"
      fill={active ? "currentColor" : "currentColor"}
    >
      <path d="M472.615,274.117V198.4l-55.335-9.255c-4.332-16.64-10.929-32.492-19.692-47.458L430.178,96l-53.563-53.563 l-45.686,32.591c-14.966-8.763-30.917-15.36-47.557-19.692L274.215,0H198.4l-9.157,55.335 c-16.64,4.332-32.591,10.929-47.557,19.692L96,42.437L42.437,96l32.591,45.686c-8.763,14.966-15.36,30.818-19.692,47.458L0,198.4 v75.717l55.335,9.255c4.332,16.64,10.929,32.591,19.692,47.557l-32.591,45.686L96,430.178l45.686-32.689 c14.966,8.862,30.917,15.458,47.557,19.791l9.157,55.335h75.815l9.157-55.335c16.64-4.332,32.591-10.929,47.557-19.791 l45.686,32.689l53.563-53.563l-32.591-45.686c8.763-14.966,15.36-30.917,19.692-47.557L472.615,274.117z M236.308,334.769 c-54.252,0-98.462-44.209-98.462-98.462c0-54.351,44.209-98.462,98.462-98.462s98.462,44.111,98.462,98.462 C334.769,290.56,290.56,334.769,236.308,334.769z" />
    </svg>
  );
}
