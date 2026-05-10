# Architecture Visualization — Phase 0 (Setup) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a working monorepo with the Next.js web app, Convex backend, Clerk auth, and Tailwind+shadcn/ui — all wired together — so that running `pnpm dev` plus `npx convex dev` shows a Clerk-authenticated landing page that can read from a Convex query, and CI passes lint + typecheck.

**Architecture:** A pnpm-workspace monorepo with three workspaces — `apps/web` (Next.js App Router), `apps/mcp-server` (Node stdio MCP, stub only in Phase 0), and `packages/shared` (Zod schemas + TypeScript types) — plus a `convex/` directory at the repo root for the Convex backend. Authentication is Clerk; the Clerk JWT is configured as a Convex auth provider so that all `useQuery`/`useMutation` calls from the browser carry the user identity.

**Tech Stack:** TypeScript, Next.js (App Router), React 18, Tailwind CSS, shadcn/ui, Convex, Clerk, Zod, pnpm workspaces, ESLint, Prettier, GitHub Actions.

**Prerequisites already done by user:**

- Node.js ≥ 20 (have 22.18.0)
- pnpm ≥ 10 (have 10.32.1)
- Git
- GitHub repo created: https://github.com/GlennAyden/Architecture-Visualization (cloned at `c:\Data\Tools\architecture-visualization`)
- Convex account signed up (no project yet)
- Clerk account signed up (no application yet)

**Out of scope for this plan:**

- Project / node / kanban schemas (Phase 1)
- tldraw integration (Phase 1)
- MCP tools logic (Phase 2)
- Production deployment (Phase 3)

---

## File Structure (what will exist at end of Phase 0)

```
architecture-visualization/
├── package.json                    [root, workspace orchestration]
├── pnpm-workspace.yaml
├── tsconfig.base.json              [shared TS config]
├── .gitignore                      [extended]
├── .editorconfig
├── .prettierrc.json
├── .prettierignore
├── eslint.config.mjs               [flat ESLint config, root]
├── README.md                       [setup + dev instructions]
├── .env.example                    [documents required env vars]
├── .github/
│   └── workflows/
│       └── ci.yml                  [lint + typecheck on PR]
├── apps/
│   ├── web/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── next.config.mjs
│   │   ├── postcss.config.mjs
│   │   ├── tailwind.config.ts
│   │   ├── components.json         [shadcn/ui config]
│   │   ├── middleware.ts           [Clerk middleware]
│   │   ├── .env.local              [gitignored, has Clerk + Convex keys]
│   │   ├── app/
│   │   │   ├── layout.tsx          [ClerkProvider + ConvexClientProvider]
│   │   │   ├── page.tsx            [landing — shows signed-in state]
│   │   │   ├── globals.css         [Tailwind + shadcn theme tokens]
│   │   │   ├── sign-in/[[...sign-in]]/page.tsx
│   │   │   └── sign-up/[[...sign-up]]/page.tsx
│   │   ├── components/
│   │   │   ├── providers.tsx       [client component wrapping Convex+Clerk]
│   │   │   └── ui/
│   │   │       └── button.tsx      [shadcn Button]
│   │   └── lib/
│   │       └── utils.ts            [shadcn `cn` helper]
│   └── mcp-server/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           └── index.ts            [stub — prints "not yet implemented"]
├── packages/
│   └── shared/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           └── index.ts            [empty exports for now]
└── convex/
    ├── schema.ts                   [profiles table only]
    ├── auth.config.ts              [Clerk JWT issuer]
    ├── profiles.ts                 [`getMe` query — verifies auth wiring]
    └── _generated/                 [auto-generated]
```

---

## Workflow conventions

- After every group of tasks that ends in **"Commit"**, the engineer runs the listed commit. Use the exact message provided.
- Commit messages follow conventional-commits style: `chore:`, `feat:`, `docs:`, `test:`.
- Never use `--no-verify`. If a hook fails, fix the issue and create a new commit.
- Run all commands from the repo root unless explicitly noted.
- This is a Windows machine using PowerShell — use the commands as written; they are PowerShell-compatible.

---

## Task 1: Root `package.json` and pnpm workspace

**Files:**

- Create: `package.json`
- Create: `pnpm-workspace.yaml`

- [ ] **Step 1.1: Write `package.json` at repo root**

```json
{
  "name": "architecture-visualization",
  "version": "0.0.0",
  "private": true,
  "engines": {
    "node": ">=20",
    "pnpm": ">=10"
  },
  "scripts": {
    "dev": "pnpm --filter @arch-viz/web dev",
    "build": "pnpm -r build",
    "lint": "pnpm -r lint",
    "typecheck": "pnpm -r typecheck",
    "format": "prettier --write .",
    "format:check": "prettier --check ."
  },
  "devDependencies": {
    "prettier": "^3.3.3",
    "typescript": "^5.6.3"
  },
  "packageManager": "pnpm@10.32.1"
}
```

- [ ] **Step 1.2: Write `pnpm-workspace.yaml`**

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

- [ ] **Step 1.3: Install root devDependencies**

Run: `pnpm install`

Expected: pnpm creates `pnpm-lock.yaml` and a `node_modules/` symlink farm. Output ends with "Done in Xs".

- [ ] **Step 1.4: Commit**

```powershell
git add package.json pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "chore: initialize pnpm workspace"
```

---

## Task 2: Shared TypeScript base config

**Files:**

- Create: `tsconfig.base.json`

- [ ] **Step 2.1: Write `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": false,
    "jsx": "preserve",
    "incremental": true
  }
}
```

- [ ] **Step 2.2: Commit**

```powershell
git add tsconfig.base.json
git commit -m "chore: add shared TypeScript base config"
```

---

## Task 3: Extend `.gitignore`

**Files:**

- Modify: `.gitignore`

- [ ] **Step 3.1: Replace `.gitignore` content**

Overwrite `.gitignore` with:

```
node_modules/
.next/
.turbo/
dist/
build/
out/
.env
.env.local
.env.*.local
.DS_Store
*.log
.vercel
.convex/
coverage/
.pnpm-store/
*.tsbuildinfo
.eslintcache
.prettiercache
```

- [ ] **Step 3.2: Commit**

```powershell
git add .gitignore
git commit -m "chore: extend gitignore for Next.js, Convex, and tooling caches"
```

---

## Task 4: `.editorconfig` and `.prettierrc.json`

**Files:**

- Create: `.editorconfig`
- Create: `.prettierrc.json`
- Create: `.prettierignore`

- [ ] **Step 4.1: Write `.editorconfig`**

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false
```

- [ ] **Step 4.2: Write `.prettierrc.json`**

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "arrowParens": "always",
  "endOfLine": "lf"
}
```

- [ ] **Step 4.3: Write `.prettierignore`**

```
node_modules
pnpm-lock.yaml
.next
.turbo
dist
build
coverage
convex/_generated
.eslintcache
.prettiercache
*.tsbuildinfo
```

- [ ] **Step 4.4: Verify Prettier runs**

Run: `pnpm format:check`

Expected: "All matched files use Prettier code style!" (no files yet to fail).

- [ ] **Step 4.5: Commit**

```powershell
git add .editorconfig .prettierrc.json .prettierignore
git commit -m "chore: add editorconfig and prettier config"
```

---

## Task 5: `packages/shared` workspace

**Files:**

- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts`

- [ ] **Step 5.1: Create directories**

Run: `New-Item -ItemType Directory -Path "packages/shared/src" -Force | Out-Null`

Expected: no output.

- [ ] **Step 5.2: Write `packages/shared/package.json`**

```json
{
  "name": "@arch-viz/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "lint": "eslint .",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "typescript": "^5.6.3"
  }
}
```

- [ ] **Step 5.3: Write `packages/shared/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "noEmit": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 5.4: Write `packages/shared/src/index.ts`**

```ts
// Shared Zod schemas and TypeScript types live here.
// Populated in Phase 1 when entity schemas are defined.
export {};
```

- [ ] **Step 5.5: Install workspace dependencies**

Run: `pnpm install`

Expected: pnpm wires `@arch-viz/shared` into the workspace; output ends with "Done in Xs".

- [ ] **Step 5.6: Verify typecheck passes**

Run: `pnpm --filter @arch-viz/shared typecheck`

Expected: exits with code 0, no errors.

- [ ] **Step 5.7: Commit**

```powershell
git add packages/shared
git commit -m "chore: scaffold @arch-viz/shared package"
```

---

## Task 6: `apps/mcp-server` stub workspace

**Files:**

- Create: `apps/mcp-server/package.json`
- Create: `apps/mcp-server/tsconfig.json`
- Create: `apps/mcp-server/src/index.ts`

- [ ] **Step 6.1: Create directories**

Run: `New-Item -ItemType Directory -Path "apps/mcp-server/src" -Force | Out-Null`

- [ ] **Step 6.2: Write `apps/mcp-server/package.json`**

```json
{
  "name": "@arch-viz/mcp-server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "bin": {
    "arch-viz-mcp": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@arch-viz/shared": "workspace:*"
  },
  "devDependencies": {
    "tsx": "^4.19.2",
    "typescript": "^5.6.3",
    "@types/node": "^22.7.5"
  }
}
```

- [ ] **Step 6.3: Write `apps/mcp-server/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "noEmit": false,
    "declaration": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 6.4: Write `apps/mcp-server/src/index.ts`**

```ts
#!/usr/bin/env node
// MCP server entry point — full implementation lands in Phase 2.
// For now this is a stub that exits cleanly so workspace tooling works.

console.error('arch-viz MCP server: not yet implemented (Phase 2)');
process.exit(0);
```

- [ ] **Step 6.5: Install workspace deps**

Run: `pnpm install`

- [ ] **Step 6.6: Verify typecheck**

Run: `pnpm --filter @arch-viz/mcp-server typecheck`

Expected: exits 0.

- [ ] **Step 6.7: Verify stub runs**

Run: `pnpm --filter @arch-viz/mcp-server dev`

Expected: stderr prints `arch-viz MCP server: not yet implemented (Phase 2)`, exit code 0.

- [ ] **Step 6.8: Commit**

```powershell
git add apps/mcp-server pnpm-lock.yaml
git commit -m "chore: scaffold mcp-server stub workspace"
```

---

## Task 7: Scaffold Next.js app at `apps/web`

**Files:**

- Create (via CLI): `apps/web/*`

- [ ] **Step 7.1: Create directory**

Run: `New-Item -ItemType Directory -Path "apps/web" -Force | Out-Null`

- [ ] **Step 7.2: Run `create-next-app`**

Run from repo root:

```powershell
pnpm create next-app@latest apps/web --ts --tailwind --eslint --app --no-src-dir --import-alias "@/*" --use-pnpm --no-turbopack
```

Expected: scaffolds Next.js 14+ app under `apps/web` with TypeScript, Tailwind, ESLint, App Router, no `src/` dir, alias `@/*`. Final line "Success! Created..." plus dependency install summary.

If create-next-app prompts interactively (older flag set, version drift), answer:

- TypeScript: **Yes**
- ESLint: **Yes**
- Tailwind CSS: **Yes**
- `src/` directory: **No**
- App Router: **Yes**
- Turbopack: **No**
- Customize import alias: **Yes**, use `@/*`

- [ ] **Step 7.3: Replace `apps/web/package.json` `name` and prune unused config**

Open `apps/web/package.json` and:

1. Change `"name"` from whatever the scaffold set to `"@arch-viz/web"`.
2. Add `"private": true` if not already.
3. Add this script alongside the existing scripts:

```json
"typecheck": "tsc --noEmit"
```

The final scripts section should be:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "next lint",
  "typecheck": "tsc --noEmit"
}
```

- [ ] **Step 7.4: Update `apps/web/tsconfig.json` to extend the base config**

Replace the contents of `apps/web/tsconfig.json` with:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./*"]
    },
    "noEmit": true
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 7.5: Re-install workspace**

Run: `pnpm install`

Expected: pnpm picks up the renamed package and links it.

- [ ] **Step 7.6: Run dev server briefly to verify scaffold works**

Run: `pnpm --filter @arch-viz/web dev`

Open http://localhost:3000 in a browser. Expected: Next.js default page renders without errors. Stop the server with Ctrl-C.

- [ ] **Step 7.7: Run typecheck**

Run: `pnpm --filter @arch-viz/web typecheck`

Expected: exits 0.

- [ ] **Step 7.8: Commit**

```powershell
git add apps/web pnpm-lock.yaml
git commit -m "chore: scaffold Next.js app at apps/web"
```

---

## Task 8: Strip Next.js scaffold's default landing content and add a clean root page

**Files:**

- Modify: `apps/web/app/page.tsx`
- Modify: `apps/web/app/layout.tsx`
- Modify: `apps/web/app/globals.css`

- [ ] **Step 8.1: Replace `apps/web/app/page.tsx`**

```tsx
export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-3xl font-semibold">Architecture Visualization</h1>
      <p className="mt-2 text-muted-foreground">Phase 0 setup — wiring in progress.</p>
    </main>
  );
}
```

- [ ] **Step 8.2: Replace `apps/web/app/layout.tsx`**

```tsx
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Architecture Visualization',
  description: 'Living architecture canvas for AI-driven development',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  );
}
```

- [ ] **Step 8.3: Replace `apps/web/app/globals.css` with a Tailwind base + shadcn-ready theme tokens**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --card: 0 0% 100%;
    --card-foreground: 222.2 84% 4.9%;
    --popover: 0 0% 100%;
    --popover-foreground: 222.2 84% 4.9%;
    --primary: 222.2 47.4% 11.2%;
    --primary-foreground: 210 40% 98%;
    --secondary: 210 40% 96.1%;
    --secondary-foreground: 222.2 47.4% 11.2%;
    --muted: 210 40% 96.1%;
    --muted-foreground: 215.4 16.3% 46.9%;
    --accent: 210 40% 96.1%;
    --accent-foreground: 222.2 47.4% 11.2%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 210 40% 98%;
    --border: 214.3 31.8% 91.4%;
    --input: 214.3 31.8% 91.4%;
    --ring: 222.2 84% 4.9%;
    --radius: 0.5rem;
  }

  .dark {
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;
    --card: 222.2 84% 4.9%;
    --card-foreground: 210 40% 98%;
    --popover: 222.2 84% 4.9%;
    --popover-foreground: 210 40% 98%;
    --primary: 210 40% 98%;
    --primary-foreground: 222.2 47.4% 11.2%;
    --secondary: 217.2 32.6% 17.5%;
    --secondary-foreground: 210 40% 98%;
    --muted: 217.2 32.6% 17.5%;
    --muted-foreground: 215 20.2% 65.1%;
    --accent: 217.2 32.6% 17.5%;
    --accent-foreground: 210 40% 98%;
    --destructive: 0 62.8% 30.6%;
    --destructive-foreground: 210 40% 98%;
    --border: 217.2 32.6% 17.5%;
    --input: 217.2 32.6% 17.5%;
    --ring: 212.7 26.8% 83.9%;
  }
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
  }
}
```

- [ ] **Step 8.4: Commit**

```powershell
git add apps/web/app
git commit -m "feat(web): minimal landing page and shadcn-ready theme tokens"
```

---

## Task 9: Configure Tailwind for shadcn/ui

**Files:**

- Modify: `apps/web/tailwind.config.ts`

- [ ] **Step 9.1: Replace `apps/web/tailwind.config.ts`**

```ts
import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: { '2xl': '1400px' },
    },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
```

- [ ] **Step 9.2: Install `tailwindcss-animate` in the web workspace**

Run: `pnpm --filter @arch-viz/web add -D tailwindcss-animate`

- [ ] **Step 9.3: Verify dev server still renders**

Run: `pnpm --filter @arch-viz/web dev`

Open http://localhost:3000. Expected: page shows "Architecture Visualization — Phase 0 setup" with the muted-foreground subtext readable. Stop with Ctrl-C.

- [ ] **Step 9.4: Commit**

```powershell
git add apps/web/tailwind.config.ts apps/web/package.json pnpm-lock.yaml
git commit -m "chore(web): configure Tailwind for shadcn/ui design tokens"
```

---

## Task 10: Initialize shadcn/ui and add Button + Card components

**Files:**

- Create: `apps/web/components.json`
- Create: `apps/web/lib/utils.ts`
- Create: `apps/web/components/ui/button.tsx`
- Create: `apps/web/components/ui/card.tsx`

- [ ] **Step 10.1: Create `apps/web/components.json` (shadcn config)**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "app/globals.css",
    "baseColor": "slate",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils"
  }
}
```

- [ ] **Step 10.2: Create `apps/web/lib/utils.ts`**

```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 10.3: Install shadcn dependencies**

Run: `pnpm --filter @arch-viz/web add clsx tailwind-merge class-variance-authority @radix-ui/react-slot lucide-react`

- [ ] **Step 10.4: Create `apps/web/components/ui/button.tsx`**

```tsx
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-md px-3',
        lg: 'h-11 rounded-md px-8',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
```

- [ ] **Step 10.5: Create `apps/web/components/ui/card.tsx`**

```tsx
import * as React from 'react';

import { cn } from '@/lib/utils';

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('rounded-lg border bg-card text-card-foreground shadow-sm', className)}
      {...props}
    />
  ),
);
Card.displayName = 'Card';

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col space-y-1.5 p-6', className)} {...props} />
  ),
);
CardHeader.displayName = 'CardHeader';

const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn('text-2xl font-semibold leading-none tracking-tight', className)}
      {...props}
    />
  ),
);
CardTitle.displayName = 'CardTitle';

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />
  ),
);
CardContent.displayName = 'CardContent';

export { Card, CardHeader, CardTitle, CardContent };
```

- [ ] **Step 10.6: Verify Button renders by replacing `apps/web/app/page.tsx` body**

Replace `apps/web/app/page.tsx`:

```tsx
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-3xl font-semibold">Architecture Visualization</h1>
      <p className="text-muted-foreground">Phase 0 setup — wiring in progress.</p>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Status</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Tailwind + shadcn/ui rendered correctly.</p>
          <Button className="mt-4">Sample Button</Button>
        </CardContent>
      </Card>
    </main>
  );
}
```

- [ ] **Step 10.7: Run dev server, confirm page renders the card + button**

Run: `pnpm --filter @arch-viz/web dev`

Open http://localhost:3000. Expected: heading, muted subtext, white card with title "Status" and a dark "Sample Button". Stop with Ctrl-C.

- [ ] **Step 10.8: Run typecheck**

Run: `pnpm --filter @arch-viz/web typecheck`

Expected: exits 0.

- [ ] **Step 10.9: Commit**

```powershell
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): add shadcn/ui Button and Card components"
```

---

## Task 11: Create Convex project and initialize the `convex/` directory

**Files:**

- Create: `convex/schema.ts`
- Create: `convex/auth.config.ts`
- Create: `convex/profiles.ts`
- Create (auto): `convex/_generated/*`
- Modify: `apps/web/package.json` (add `convex` dependency)

- [ ] **Step 11.1: Install Convex CLI in the web app**

Run: `pnpm --filter @arch-viz/web add convex`

- [ ] **Step 11.2: Run Convex init from the repo root**

Run from repo root: `pnpm dlx convex@latest dev --once --configure new`

This will:

1. Open a browser tab to log in to Convex (sign in with GitHub).
2. Prompt for a project name — type **`architecture-visualization`** and confirm.
3. Create a `convex/` directory at repo root.
4. Add a `NEXT_PUBLIC_CONVEX_URL` value to `apps/web/.env.local` (auto-detected workspace).
5. Generate `convex/_generated/*`.

Expected stdout includes lines such as:

```
✔ Convex dev deployment created
Provisioning a new dev deployment for project "architecture-visualization"
```

If the CLI does not auto-detect `apps/web` and asks for a "configured directory", point it there.

- [ ] **Step 11.3: Verify `apps/web/.env.local` was created**

Run: `Get-Content apps/web/.env.local`

Expected: file contains `CONVEX_DEPLOYMENT=...` and `NEXT_PUBLIC_CONVEX_URL=https://....convex.cloud`.

If the file is missing, manually create it with the deployment URL printed in the previous step.

- [ ] **Step 11.4: Replace `convex/schema.ts`**

```ts
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  profiles: defineTable({
    clerkId: v.string(),
    email: v.string(),
  }).index('by_clerk', ['clerkId']),
});
```

- [ ] **Step 11.5: Create `convex/auth.config.ts` placeholder**

The Clerk issuer domain comes from the Clerk dashboard later. For now write a placeholder that reads from an env var so the schema can deploy.

```ts
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN ?? 'https://placeholder.clerk.accounts.dev',
      applicationID: 'convex',
    },
  ],
};
```

- [ ] **Step 11.6: Create `convex/profiles.ts` with a `getMe` query**

This query exercises the auth wiring; in Phase 0 it returns `null` if not signed in.

```ts
import { query } from './_generated/server';

export const getMe = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const existing = await ctx.db
      .query('profiles')
      .withIndex('by_clerk', (q) => q.eq('clerkId', identity.subject))
      .unique();
    return existing ?? { clerkId: identity.subject, email: identity.email ?? '' };
  },
});
```

- [ ] **Step 11.7: Push schema to dev deployment**

Run from repo root: `pnpm dlx convex dev --once`

Expected: schema is uploaded; output includes "Schema validation OK" and "Deployed functions". The `convex/_generated/` directory is updated.

- [ ] **Step 11.8: Commit**

```powershell
git add convex apps/web/package.json pnpm-lock.yaml
git commit -m "feat(convex): initialize backend with profiles schema and getMe query"
```

> **Note:** `apps/web/.env.local` is gitignored. Do not commit it.

---

## Task 12: Create Clerk application and configure JWT template for Convex

This task involves browser steps. Document each click carefully.

- [ ] **Step 12.1: Create the Clerk application**

In a browser, open https://dashboard.clerk.com.

1. Click **"Create application"**.
2. Application name: **`Architecture Visualization`**.
3. Sign-in methods: enable **Email** (with magic link) and any others you want (Google OAuth optional).
4. Click **"Create application"**.

Clerk redirects to a **"Quickstart"** page that shows two keys:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (starts with `pk_test_`)
- `CLERK_SECRET_KEY` (starts with `sk_test_`)

Keep this tab open.

- [ ] **Step 12.2: Add Clerk keys to `apps/web/.env.local`**

Append these lines to `apps/web/.env.local` (do NOT commit):

```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_REPLACE_ME
CLERK_SECRET_KEY=sk_test_REPLACE_ME
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/
```

Replace the `REPLACE_ME` values with the actual keys from the Clerk dashboard.

- [ ] **Step 12.3: Create the Convex JWT template in Clerk**

In the Clerk dashboard:

1. Left sidebar → **"JWT Templates"** (under "Configure").
2. Click **"+ New template"**.
3. Click **"Convex"** from the list of presets.
4. Leave the name as `convex` (lowercase).
5. Click **"Save"**.

Clerk shows an **Issuer** URL (e.g., `https://your-instance.clerk.accounts.dev`). Copy it.

- [ ] **Step 12.4: Configure Convex to trust the Clerk issuer**

Set the issuer in the Convex deployment env:

Run from repo root:

```powershell
pnpm dlx convex env set CLERK_JWT_ISSUER_DOMAIN "<paste the issuer URL from previous step>"
```

Expected output: `Environment variable CLERK_JWT_ISSUER_DOMAIN set on deployment ...`.

- [ ] **Step 12.5: Push the auth config so Convex picks up the env var**

Run: `pnpm dlx convex dev --once`

Expected: deployment redeploys; `auth.config.ts` now reflects the real Clerk issuer.

- [ ] **Step 12.6: No commit yet** — `.env.local` is gitignored and the only files changed in this task are gitignored.

---

## Task 13: Wire Clerk into the Next.js app

**Files:**

- Create: `apps/web/middleware.ts`
- Create: `apps/web/components/providers.tsx`
- Modify: `apps/web/app/layout.tsx`

- [ ] **Step 13.1: Install Clerk and Convex React SDKs**

Run: `pnpm --filter @arch-viz/web add @clerk/nextjs convex`

(`convex` was already installed in Task 11; this is idempotent.)

- [ ] **Step 13.2: Create `apps/web/middleware.ts`**

```ts
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isPublicRoute = createRouteMatcher(['/sign-in(.*)', '/sign-up(.*)']);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: ['/((?!.+\\.[\\w]+$|_next).*)', '/', '/(api|trpc)(.*)'],
};
```

- [ ] **Step 13.3: Create `apps/web/components/providers.tsx`**

```tsx
'use client';

import { ReactNode } from 'react';
import { ClerkProvider, useAuth } from '@clerk/nextjs';
import { ConvexProviderWithClerk } from 'convex/react-clerk';
import { ConvexReactClient } from 'convex/react';

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider>
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        {children}
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}
```

- [ ] **Step 13.4: Update `apps/web/app/layout.tsx` to use the providers**

```tsx
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/providers';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Architecture Visualization',
  description: 'Living architecture canvas for AI-driven development',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

- [ ] **Step 13.5: Create sign-in route**

Create file `apps/web/app/sign-in/[[...sign-in]]/page.tsx`:

```tsx
import { SignIn } from '@clerk/nextjs';

export default function Page() {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <SignIn />
    </main>
  );
}
```

- [ ] **Step 13.6: Create sign-up route**

Create file `apps/web/app/sign-up/[[...sign-up]]/page.tsx`:

```tsx
import { SignUp } from '@clerk/nextjs';

export default function Page() {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <SignUp />
    </main>
  );
}
```

- [ ] **Step 13.7: Make `apps/web/app/page.tsx` show signed-in state and exercise the Convex query**

```tsx
'use client';

import { useQuery } from 'convex/react';
import { UserButton } from '@clerk/nextjs';
import { api } from '../../../convex/_generated/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function Home() {
  const me = useQuery(api.profiles.getMe);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <div className="absolute right-4 top-4">
        <UserButton afterSignOutUrl="/sign-in" />
      </div>
      <h1 className="text-3xl font-semibold">Architecture Visualization</h1>
      <p className="text-muted-foreground">Phase 0 setup — wiring verified.</p>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Auth + Convex check</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm">
            <strong>Convex query result:</strong>{' '}
            {me === undefined ? 'loading…' : JSON.stringify(me)}
          </p>
          <Button className="mt-4" variant="outline">
            Sample Button
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
```

- [ ] **Step 13.8: Verify import path of `api`**

Open `apps/web/app/page.tsx` and confirm the import line `import { api } from '../../../convex/_generated/api';` resolves. From `apps/web/app/` you go up three levels to repo root, then into `convex/_generated/`. If your editor flags this path, run typecheck — TypeScript will tell you the right path.

If TypeScript errors, fix the relative path until typecheck passes.

- [ ] **Step 13.9: Run `convex dev` and `next dev` in two terminals**

Terminal 1 (from repo root): `pnpm dlx convex dev`

Terminal 2 (from repo root): `pnpm dev`

Open http://localhost:3000.

Expected: middleware redirects unauthenticated visitor to `/sign-in`. After signing up with email magic link, you land on `/`. The card shows the Convex query result — either `null` (no profile row yet) or an object `{clerkId: "user_…", email: "you@example.com"}`. The Clerk `UserButton` is visible top-right.

If the page shows an error like "convex query failed: not authorized" check that:

1. Clerk JWT template named exactly `convex` exists.
2. Convex env var `CLERK_JWT_ISSUER_DOMAIN` matches the issuer in the Clerk dashboard.
3. `apps/web/.env.local` has both `NEXT_PUBLIC_CONVEX_URL` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` set.

Stop both servers with Ctrl-C when verified.

- [ ] **Step 13.10: Run typecheck**

Run: `pnpm --filter @arch-viz/web typecheck`

Expected: exits 0.

- [ ] **Step 13.11: Commit**

```powershell
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): wire Clerk auth and Convex provider into Next.js app"
```

---

## Task 14: Add `.env.example` to document required env vars

**Files:**

- Create: `.env.example`
- Create: `apps/web/.env.example`

- [ ] **Step 14.1: Write `apps/web/.env.example`**

```
# Convex (auto-set by `convex dev`)
CONVEX_DEPLOYMENT=
NEXT_PUBLIC_CONVEX_URL=

# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/
```

- [ ] **Step 14.2: Write top-level `.env.example`** documenting Convex deployment env

```
# Set in Convex deployment via `pnpm dlx convex env set ...`
# CLERK_JWT_ISSUER_DOMAIN=https://<your-instance>.clerk.accounts.dev
```

- [ ] **Step 14.3: Commit**

```powershell
git add .env.example apps/web/.env.example
git commit -m "docs: document required environment variables"
```

---

## Task 15: Configure ESLint flat config at repo root

**Files:**

- Create: `eslint.config.mjs`
- Modify: `apps/web/package.json` (no-op — Next ships its own ESLint)

- [ ] **Step 15.1: Remove the per-app ESLint config that create-next-app may have generated**

create-next-app v15+ writes an `eslint.config.mjs` under `apps/web/`. We want a single root flat config covering the entire workspace, so delete the per-app one if it exists:

```powershell
if (Test-Path "apps/web/eslint.config.mjs") { Remove-Item "apps/web/eslint.config.mjs" }
if (Test-Path "apps/web/.eslintrc.json")    { Remove-Item "apps/web/.eslintrc.json" }
```

Also remove the `lint` script from `apps/web/package.json` (the root flat config will handle it). Edit `apps/web/package.json` and delete this line from `scripts`:

```json
"lint": "next lint",
```

- [ ] **Step 15.2: Install ESLint and shared plugins at the repo root**

Run from repo root:

```powershell
pnpm add -Dw eslint @eslint/js typescript-eslint eslint-config-prettier globals
```

- [ ] **Step 15.3: Write `eslint.config.mjs`**

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/build/**',
      'convex/_generated/**',
      '**/*.config.{js,mjs,cjs,ts}',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  prettier,
];
```

- [ ] **Step 15.4: Update root `package.json` to add an `eslint` script**

In the root `package.json`, replace the `"lint"` script with:

```json
"lint": "eslint . --max-warnings=0"
```

- [ ] **Step 15.5: Verify lint passes**

Run: `pnpm lint`

Expected: exits 0 with no warnings or errors. (Per-package `lint` scripts in workspaces are still wired via `pnpm -r lint`; the root `lint` runs the flat config across the whole repo.)

If errors appear, fix them. Common: `no-explicit-any` in providers — already handled by the `@typescript-eslint/no-unused-vars` softening above; no other warnings expected at this point.

- [ ] **Step 15.6: Commit**

```powershell
git add eslint.config.mjs package.json pnpm-lock.yaml
git commit -m "chore: add flat ESLint config at repo root"
```

---

## Task 16: GitHub Actions CI workflow

**Files:**

- Create: `.github/workflows/ci.yml`

- [ ] **Step 16.1: Create directory**

Run: `New-Item -ItemType Directory -Path ".github/workflows" -Force | Out-Null`

- [ ] **Step 16.2: Write `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  lint-and-typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 10

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Format check
        run: pnpm format:check

      - name: Lint
        run: pnpm lint

      - name: Typecheck
        run: pnpm typecheck
```

> Note: typecheck is workspace-level (`pnpm -r typecheck`); each workspace must define a `typecheck` script that exits non-zero on TS errors. Already handled in tasks 5, 6, 7.

- [ ] **Step 16.3: Run all three checks locally to make sure CI will pass**

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
```

Expected: all three exit 0.

If any fails, fix before continuing — CI on push will run the same commands.

- [ ] **Step 16.4: Commit**

```powershell
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions workflow for lint + typecheck"
```

---

## Task 17: Write README

**Files:**

- Create: `README.md`

- [ ] **Step 17.1: Write `README.md`**

````markdown
# Architecture Visualization

A living architecture canvas that mirrors the structure of your project and stays in sync with AI-driven development. Each node represents a page or feature with a kanban (todo / doing / done), description, linked files, and activity log.

> **Status:** Phase 0 (setup). See `docs/superpowers/specs/2026-05-10-architecture-visualization-design.md` for the full design.

## Stack

TypeScript · Next.js (App Router) · Tailwind + shadcn/ui · tldraw · Convex · Clerk · Node MCP server · pnpm workspaces.

## Prerequisites

- Node.js ≥ 20
- pnpm ≥ 10
- A Convex account (https://convex.dev)
- A Clerk account (https://clerk.com)

## Local development

1. Install dependencies:

   ```bash
   pnpm install
   ```
````

2. Provision Convex (first time only):

   ```bash
   pnpm dlx convex dev --once --configure new
   ```

   Follow prompts to log in and create the `architecture-visualization` project. This populates `apps/web/.env.local` with `CONVEX_DEPLOYMENT` and `NEXT_PUBLIC_CONVEX_URL`.

3. Provision Clerk (first time only):
   - Create an application in https://dashboard.clerk.com.
   - Copy the publishable and secret keys to `apps/web/.env.local`. See `apps/web/.env.example` for variable names.
   - Create a JWT template named `convex` (use the Convex preset).
   - Set the Convex deployment env var:

     ```bash
     pnpm dlx convex env set CLERK_JWT_ISSUER_DOMAIN "https://<your-instance>.clerk.accounts.dev"
     ```

4. Run dev servers in two terminals:

   ```bash
   pnpm dlx convex dev   # backend
   pnpm dev              # web app on http://localhost:3000
   ```

## Repository layout

```
apps/web          Next.js app (UI + API routes)
apps/mcp-server   Stdio MCP server (Phase 2)
packages/shared   Zod schemas, shared types
convex/           Convex backend (schema, queries, mutations, HTTP actions)
docs/             Design specs and implementation plans
```

## Scripts

| Command               | What it does                         |
| --------------------- | ------------------------------------ |
| `pnpm dev`            | Run the Next.js web app              |
| `pnpm dlx convex dev` | Run the Convex dev backend           |
| `pnpm lint`           | Run ESLint across the repo           |
| `pnpm typecheck`      | Run TypeScript across all workspaces |
| `pnpm format`         | Apply Prettier formatting            |
| `pnpm format:check`   | Verify Prettier formatting           |

````

- [ ] **Step 17.2: Verify Prettier accepts the README**

Run: `pnpm format:check`

Expected: exits 0.

- [ ] **Step 17.3: Commit**

```powershell
git add README.md
git commit -m "docs: add README with setup and dev instructions"
````

---

## Task 18: Final verification

- [ ] **Step 18.1: Clean install to confirm reproducibility**

Run from repo root:

```powershell
Remove-Item -Recurse -Force node_modules, apps\web\node_modules, apps\mcp-server\node_modules, packages\shared\node_modules
pnpm install --frozen-lockfile
```

Expected: install completes without errors.

- [ ] **Step 18.2: Run all CI commands locally**

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
```

Expected: all three exit 0.

- [ ] **Step 18.3: End-to-end smoke test**

Two terminals:

```powershell
# Terminal 1
pnpm dlx convex dev
```

```powershell
# Terminal 2
pnpm dev
```

Open http://localhost:3000.

Expected:

- Visit redirects to `/sign-in`.
- Sign up with email magic link (check inbox).
- Land back on `/`. Card displays Convex query result (`{clerkId: "user_...", email: "..."}` or `null` initially) and a Sample Button. UserButton visible top-right.

Stop both servers when verified.

- [ ] **Step 18.4: Push to GitHub and confirm CI passes**

```powershell
git push origin main
```

Open https://github.com/GlennAyden/Architecture-Visualization/actions and confirm the CI run is green.

- [ ] **Step 18.5: Tag Phase 0 complete**

```powershell
git tag -a phase-0 -m "Phase 0 setup complete"
git push origin phase-0
```

---

## Phase 0 Done — Definition of Done checklist

- [ ] `pnpm install` from a clean clone succeeds.
- [ ] `pnpm format:check`, `pnpm lint`, `pnpm typecheck` all pass.
- [ ] `pnpm dev` + `pnpm dlx convex dev` together produce a Clerk-protected page that successfully calls a Convex query.
- [ ] CI on GitHub is green.
- [ ] `convex/_generated/` exists and is gitignored (verify with `git check-ignore convex/_generated/api.d.ts` — should output the path).
- [ ] `.env.local` files exist locally but are not committed (verify with `git status`).
