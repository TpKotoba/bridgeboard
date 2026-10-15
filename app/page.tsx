import Scoreboard from '@/components/scoreboard';
import CompetitionHub from '@/components/competition-hub';
export default async function Page({ searchParams }: { searchParams: Promise<{ event?: string; competition?: string }> }) {
  const params = await searchParams;
  return params.event ? <Scoreboard /> : <CompetitionHub competitionId={params.competition} />;
}
