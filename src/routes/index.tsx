import { createFileRoute } from "@tanstack/react-router";
import { EvvroomApp } from "@/components/evvroom-app";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return <EvvroomApp />;
}
