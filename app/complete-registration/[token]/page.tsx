import CompleteRegistrationForm from "./form";

export const dynamic = "force-dynamic";

export default async function CompleteRegistrationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <CompleteRegistrationForm token={token} />;
}
