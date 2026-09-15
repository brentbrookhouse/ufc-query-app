import Link from "next/link";

const links = [
  { href: "/", label: "When Was..." },
  { href: "/check", label: "Check a Result" },
  { href: "/card-preview", label: "Card Preview" },
  { href: "/methods", label: "Finish-Type Search" },
  { href: "/fighters", label: "Fighter Search" },
];

export default function NavBar() {
  return (
    <nav className="flex gap-4 border-b border-zinc-200 pb-4 text-sm dark:border-zinc-800">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
