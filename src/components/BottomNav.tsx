"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useDeckStore } from "@/store/deckStore";

const tabs = [
  { href: "/randomizer", label: "Randomizer", icon: ClimberIcon },
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

function ClimberIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 149 190"
      fill={active ? "currentColor" : "currentColor"}
    >
      <path d="M76.4415 130.313C74.6446 131.016 72.5352 131.406 70.4258 131.406C68.1602 131.406 65.9727 131.172 63.8633 130.547L40.6602 183.906C38.5508 188.828 32.6915 190.469 27.6133 187.656C22.5352 184.766 20.1133 178.516 22.3008 173.594L50.7383 108.281L87.0665 102.188L105.426 93.6719C110.27 91.3281 116.52 95.3125 117.77 100.391L126.754 136.484C128.004 141.641 124.879 146.797 119.801 148.047C114.645 149.297 109.488 146.172 108.16 141.094L102.457 118.047L76.4415 130.313Z" />
      <path d="M19.8008 78.125C21.9102 81.4063 26.0508 82.8125 29.8008 81.25L50.8165 73.0469V110.203L87.1446 102.188V68.4375L119.723 16.4063C122.145 12.5781 120.973 7.57813 117.145 5.15626C113.316 2.73438 108.316 3.90626 106.207 7.57813L78.5508 51.7969L61.9102 51.875C60.8164 51.875 59.8008 52.0313 58.7071 52.5L29.879 63.6719L15.0352 41.1719C12.6133 37.4219 7.53522 36.3281 3.78522 38.75C-0.0429094 41.1719 -1.13666 46.25 1.28522 50.0781L19.8008 78.125Z" />
      <path d="M66.4415 48.8281C74.4102 48.8281 80.8946 42.3437 80.8946 34.375C80.8946 26.4063 74.4102 19.9219 66.4415 19.9219C58.4727 19.9219 51.9883 26.4063 51.9883 34.375C51.9883 42.3437 58.4727 48.8281 66.4415 48.8281Z" />
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
