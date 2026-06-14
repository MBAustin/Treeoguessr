import { openAnswer } from "@/lib/sign";

// Spending a lifeline reveals the multiple-choice options that were sealed in
// the round token (kept hidden until now so typed modes can't be cheated).
export async function POST(request: Request) {
  let body: { token?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (typeof body.token !== "string") {
    return Response.json({ error: "Missing token." }, { status: 400 });
  }

  const answer = openAnswer(body.token);
  if (answer == null) {
    return Response.json({ error: "Invalid or tampered token." }, { status: 400 });
  }

  return Response.json({ options: answer.options });
}
