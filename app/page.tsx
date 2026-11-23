import { currentUser } from "@/lib/server";
import App from "@/components/App";
import Login from "@/components/Login";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await currentUser().catch(() => null);
  return user ? <App userName={user.name} /> : <Login />;
}
