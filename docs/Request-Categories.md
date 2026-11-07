# Request categories and smarter search (parked idea)

Updated 6 November 2026. An idea we talked through and parked until the main flow works. Nothing here is final: whoever picks it up starts with the open questions at the end.

## Where it came from

It came up while looking at the AI that turns a rough ask into a clear question. One kind of message can't fit every reason people reach out: someone with a question, someone looking for a job and someone who just wants to meet a person from home each need a different first message.

## 1. Search that narrows the list

- Once someone has made their profile and searched, they see a list of people, with the filters the search used shown under the search box.
- They can type in plain words to change the list, for example "someone from Canada who works with Kubernetes", and get a different set of people. The filters under the search box change to show what the app understood.
- We don't ask people which state they live in, so "someone from Utah" has two answers:
  - **Suggested for the hackathon:** the app says it doesn't know states and shows everyone in that country instead. Nothing new to collect.
  - **Later, if people ask for it:** ask for the state when people set up their profile. That means a new question, a list of states for every country, and a new show/hide choice.
- People who hid their country never show up in a search by country, so searching can't reveal what someone chose to hide. *(Suggested.)*

## 2. Sending a request

- The sender picks people one at a time. There's no way to message 100 people at once, so it can't turn into spam.
- They press Connect and choose one of four categories. Only then does the AI write a message, for that person and that category. No AI message appears before they choose.
- They can edit the message, or skip the AI and write their own.
- The AI uses only what the sender is asking about, the sender's own profile, and what the other person shows on their card. *(Suggested.)*

The four categories *(suggested, not yet agreed)*:

1. **Ask my question:** why the two of you are a good fit, plus the question.
2. **Work together:** build or research something together.
3. **Job or career:** the sender wants a job or career advice. Hiring could be a category of its own, so people can turn off recruiters separately.
4. **Just say hi:** same country, same workplace or same community.

They grew from the first ideas: how the two profiles fit, wanting to make a friend (say, someone from the same country), and looking for a job, with the fourth left open.

## 3. Receiving requests

- Each request in the inbox shows its category and its message.
- The receiver can decline every request in one category at once, with one note they write and save, such as "I'm not hiring".
- That category is then turned off for them *(suggested: until they turn it back on)*.
- New senders get a warning when they choose that category for this person *(suggested: before the AI writes anything, so nobody's time is wasted)*.

## How it fits the PRD

- **Fits:** the [PRD](Hackathon-PRD.pdf) already lists automatic declines by type of request as a second-priority item (FR-14). Picking people one at a time fits its goal of fewer, better requests.
- **Changes:** the PRD says the conversation helper "does not suggest an opening message" (FR-15). This idea does just that, so that line should be changed on purpose.
- **To watch:** the PRD wants requests that "state the question up front" and warns against "generic interest matching that looks like every competitor". "Just say hi" leans that way.

## When, and who

- **Parked on 6 November.** The main flow comes first. Then one person, A or B, builds all of it, screens and backend together, so nothing has to go back and forth between A and B.
- **Why wait:** it sits on the send and inbox screens, which aren't built yet. Nothing built in the meantime gets thrown away.
- **No spare slot at the end:** in the [plan](Plan-of-Action.md), Sunday evening is the freeze, with only fixes after it, and build-day morning is for fixing whatever is slowest, plus small second-priority items. So the window is Sunday, after the whole flow works on the live site (C3) and before the freeze. Declining a whole category, on its own, might be small enough for build-day morning.
- **Order:** sending first (the categories, the AI message, writing your own), then declining a whole category, then search. Whatever isn't done when rehearsal starts goes in the pitch as "what's next".
- **Rough size:** about a day for the request parts and half a day for search.

## Open questions

1. Which four categories, and should hiring be its own?
2. Can someone send a request without writing an ask first? Today every request starts from an ask.
3. Does "Just say hi" belong, given what the PRD wants?
