export const nameKey = (name: string) =>
  name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}]/gu, '');

export const jaroWinkler = (a: string, b: string) => {
  if (a === b) return a ? 1 : 0;
  if (!a || !b) return 0;
  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const used = new Array<boolean>(b.length).fill(false);
  const matched: string[] = [];
  const positions: number[] = [];
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - window); j < Math.min(b.length, i + window + 1); j++) {
      if (!used[j] && a[i] === b[j]) {
        used[j] = true;
        matched.push(a[i] as string);
        positions.push(j);
        break;
      }
    }
  }
  if (!matched.length) return 0;
  const inB = positions.toSorted((x, y) => x - y).map((j) => b[j]);
  const transpositions = matched.filter((c, i) => c !== inB[i]).length / 2;
  const m = matched.length;
  const jaro = (m / a.length + m / b.length + (m - transpositions) / m) / 3;
  let prefix = 0;
  while (prefix < 4 && a[prefix] !== undefined && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
};

const NICKNAME_GROUPS: readonly (readonly string[])[] = [
  ['abigail', 'abby', 'gail'],
  ['alexander', 'alex', 'al', 'xander', 'sasha'],
  ['alexandra', 'alex', 'lexi', 'sandra', 'sandy', 'sasha'],
  ['andrew', 'andy', 'drew'],
  ['ann', 'anne', 'anna', 'annie', 'nancy'],
  ['anthony', 'tony'],
  ['barbara', 'barb', 'barbie'],
  ['benjamin', 'ben', 'benny'],
  ['caroline', 'carol', 'carrie'],
  ['charles', 'charlie', 'chuck', 'chas'],
  ['christina', 'christine', 'chris', 'tina'],
  ['christopher', 'chris', 'kit'],
  ['cynthia', 'cindy'],
  ['daniel', 'dan', 'danny'],
  ['david', 'dave', 'davey'],
  ['deborah', 'debra', 'deb', 'debbie'],
  ['donald', 'don', 'donnie'],
  ['dorothy', 'dot', 'dottie'],
  ['douglas', 'doug'],
  ['edward', 'ed', 'eddie', 'ted', 'ned'],
  ['eleanor', 'ellie', 'nell', 'nora'],
  ['elizabeth', 'liz', 'lizzie', 'beth', 'betty', 'eliza', 'libby'],
  ['frances', 'fran', 'frannie'],
  ['frederick', 'fred', 'freddy'],
  ['gerald', 'jerry'],
  ['gregory', 'greg'],
  ['henry', 'hank', 'harry'],
  ['jacqueline', 'jackie'],
  ['james', 'jim', 'jimmy', 'jamie'],
  ['jeffrey', 'geoffrey', 'jeff'],
  ['jennifer', 'jen', 'jenny'],
  ['jessica', 'jess', 'jessie'],
  ['john', 'jack', 'johnny', 'jon'],
  ['jonathan', 'jon', 'johnny', 'nathan'],
  ['joseph', 'joe', 'joey'],
  ['josephine', 'jo', 'josie'],
  ['joshua', 'josh'],
  ['judith', 'judy'],
  ['katherine', 'catherine', 'kathryn', 'kate', 'katie', 'kathy', 'cathy', 'kat'],
  ['kenneth', 'ken', 'kenny'],
  ['kimberly', 'kim'],
  ['lawrence', 'larry'],
  ['madeline', 'madeleine', 'maddie'],
  ['margaret', 'maggie', 'meg', 'peggy', 'marge'],
  ['mary', 'molly', 'polly', 'mae'],
  ['matthew', 'matt'],
  ['michael', 'mike', 'mikey', 'mick'],
  ['nathaniel', 'nathan', 'nate'],
  ['nicholas', 'nick', 'nicky'],
  ['pamela', 'pam'],
  ['patricia', 'pat', 'patty', 'trish', 'tricia'],
  ['patrick', 'pat', 'paddy'],
  ['peter', 'pete'],
  ['raymond', 'ray'],
  ['rebecca', 'becky', 'becca'],
  ['richard', 'rick', 'ricky', 'rich', 'dick'],
  ['robert', 'bob', 'bobby', 'rob', 'robbie', 'bert'],
  ['ronald', 'ron', 'ronnie'],
  ['samantha', 'sam', 'sammy'],
  ['samuel', 'sam', 'sammy'],
  ['sarah', 'sara', 'sally'],
  ['stephen', 'steven', 'steve'],
  ['susan', 'sue', 'susie'],
  ['theresa', 'teresa', 'terry', 'tess'],
  ['thomas', 'tom', 'tommy'],
  ['timothy', 'tim', 'timmy'],
  ['victoria', 'vicky', 'tori'],
  ['virginia', 'ginny'],
  ['william', 'bill', 'billy', 'will', 'willy', 'liam'],
  ['zachary', 'zach', 'zack']
];

const groupsOf = new Map<string, Set<number>>();
NICKNAME_GROUPS.forEach((names, i) => {
  for (const name of names) groupsOf.set(name, (groupsOf.get(name) ?? new Set()).add(i));
});

const isNickname = (a: string, b: string) => {
  const groups = groupsOf.get(a);
  return !!groups && [...(groupsOf.get(b) ?? [])].some((g) => groups.has(g));
};

export const NICKNAME_LIKENESS = 0.95;

const SPELLING_LIKENESS = 0.94;

const INITIAL_LIKENESS = 0.85;

export const firstNameLikeness = (a: string, b: string) => {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (isNickname(a, b)) return NICKNAME_LIKENESS;
  if (a.length === 1 || b.length === 1) return a[0] === b[0] ? INITIAL_LIKENESS : 0;
  return Math.min(jaroWinkler(a, b), SPELLING_LIKENESS);
};
