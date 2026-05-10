import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-3xl font-semibold">Architecture Visualization</h1>
      <p className="text-muted-foreground">Phase 0 setup — wiring in progress.</p>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Status</CardTitle>
          <CardDescription>Tailwind + shadcn/ui rendered correctly.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button>Sample Button</Button>
        </CardContent>
      </Card>
    </main>
  );
}
