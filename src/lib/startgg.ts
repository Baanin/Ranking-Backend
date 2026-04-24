/**
 * Minimal start.gg GraphQL client.
 *
 * Docs:       https://developer.start.gg/docs/intro
 * Endpoint:   https://api.start.gg/gql/alpha
 * Auth:       Authorization: Bearer {STARTGG_API_TOKEN}
 *
 * We only need a handful of read queries to import tournament standings,
 * so we avoid pulling a full GraphQL client library.
 */

const ENDPOINT = 'https://api.start.gg/gql/alpha';

export class StartggError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly errors?: unknown,
  ) {
    super(message);
  }
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
}

async function graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const token = process.env.STARTGG_API_TOKEN;
  if (!token) {
    throw new StartggError('STARTGG_API_TOKEN is not configured in the backend .env');
  }

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    // Common case: 429 when exceeding 80 reqs/60s
    throw new StartggError(
      `start.gg API returned HTTP ${res.status}`,
      res.status,
    );
  }

  const json = (await res.json()) as GraphQLResponse<T>;
  if (json.errors && json.errors.length > 0) {
    throw new StartggError(
      `start.gg GraphQL errors: ${json.errors.map((e) => e.message).join('; ')}`,
      res.status,
      json.errors,
    );
  }
  if (!json.data) {
    throw new StartggError('start.gg GraphQL: empty response');
  }
  return json.data;
}

// ---------------------------------------------------------------------------
// Types (a subset — just what we consume)
// ---------------------------------------------------------------------------

export interface StartggEvent {
  id: number;
  name: string;
  slug: string;         // "tournament/{t-slug}/event/{e-slug}"
  state: string;        // CREATED | ACTIVE | COMPLETED | ...
  numEntrants: number | null;
  startAt: number | null; // UNIX seconds
  videogame: {
    id: number;
    name: string;
  } | null;
  tournament: {
    id: number;
    name: string;
    slug: string;
    city: string | null;
    countryCode: string | null;
    venueAddress: string | null;
    startAt: number | null;
    endAt: number | null;
  };
}

export interface StartggStandingEntrant {
  placement: number;
  entrant: {
    id: number;
    name: string; // "Prefix | Tag" or just "Tag"
    participants: Array<{
      id: number;
      gamerTag: string;
      user: {
        id: number;
        slug: string; // "user/xxxxxxxx"
        name: string | null;
        genderPronoun: string | null;
        location: {
          country: string | null;
          countryId: number | null;
        } | null;
      } | null;
    }>;
  };
}

// ---------------------------------------------------------------------------
// Slug parsing
// ---------------------------------------------------------------------------

/**
 * Accepts any of:
 *   https://start.gg/tournament/foo/event/bar
 *   https://www.start.gg/tournament/foo/event/bar/overview
 *   tournament/foo/event/bar
 *
 * Returns the canonical event slug "tournament/foo/event/bar", or null.
 */
export function parseEventSlug(input: string): string | null {
  const clean = input.trim();
  const match = clean.match(/tournament\/([^/?#]+)\/event\/([^/?#]+)/i);
  if (!match) return null;
  return `tournament/${match[1]}/event/${match[2]}`;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

const EVENT_QUERY = /* GraphQL */ `
  query Event($slug: String!) {
    event(slug: $slug) {
      id
      name
      slug
      state
      numEntrants
      startAt
      videogame { id name }
      tournament {
        id
        name
        slug
        city
        countryCode
        venueAddress
        startAt
        endAt
      }
    }
  }
`;

export async function fetchEventBySlug(slug: string): Promise<StartggEvent | null> {
  const data = await graphql<{ event: StartggEvent | null }>(EVENT_QUERY, { slug });
  return data.event;
}

const STANDINGS_QUERY = /* GraphQL */ `
  query Standings($eventId: ID!, $page: Int!, $perPage: Int!) {
    event(id: $eventId) {
      standings(query: { page: $page, perPage: $perPage }) {
        pageInfo { totalPages total }
        nodes {
          placement
          entrant {
            id
            name
            participants {
              id
              gamerTag
              user {
                id
                slug
                name
                genderPronoun
                location { country countryId }
              }
            }
          }
        }
      }
    }
  }
`;

interface StandingsPage {
  event: {
    standings: {
      pageInfo: { totalPages: number; total: number };
      nodes: StartggStandingEntrant[];
    } | null;
  } | null;
}

/**
 * Fetches ALL standings for an event, paging automatically.
 * start.gg caps perPage at around 100 — we use 64 to stay well under.
 */
export async function fetchAllStandings(eventId: number): Promise<StartggStandingEntrant[]> {
  const perPage = 64;
  const all: StartggStandingEntrant[] = [];
  let page = 1;
  while (true) {
    const data = await graphql<StandingsPage>(STANDINGS_QUERY, {
      eventId: String(eventId),
      page,
      perPage,
    });
    const standings = data.event?.standings;
    if (!standings) break;
    all.push(...standings.nodes);
    if (page >= standings.pageInfo.totalPages) break;
    page += 1;
    // polite throttle: start.gg allows ~80 rpm
    await new Promise((r) => setTimeout(r, 150));
  }
  return all;
}

/**
 * Convenience wrapper: given a URL or slug, return the event + its standings.
 */
export async function fetchEventWithStandings(slugOrUrl: string): Promise<{
  event: StartggEvent;
  standings: StartggStandingEntrant[];
} | null> {
  const slug = parseEventSlug(slugOrUrl);
  if (!slug) return null;
  const event = await fetchEventBySlug(slug);
  if (!event) return null;
  const standings = await fetchAllStandings(event.id);
  return { event, standings };
}
