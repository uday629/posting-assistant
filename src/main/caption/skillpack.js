// More built-in skills (plain text guides). The chat and the caption writer follow the ones that are turned on.
module.exports = [
  {
    id: 'linkedin-posts', name: 'LinkedIn post writer', appliesTo: ['caption', 'chat'],
    description: 'Write LinkedIn posts that earn comments: choose the right kind, ask what is missing, then write.',
    body: `# LinkedIn post writer
Before writing, if the user did not say, ask ONE short question with options: goal (authority, leads, hiring, story, opinion), audience, and length (short 600 chars, medium 1000, long 1500).
Kinds and when to use them:
- Story post: a real moment, the lesson, one question. Best for reach.
- Lesson list: "5 things I learned..." with one line each. Best for saves.
- Contrarian take: a common belief, why it fails, what to do instead. Best for comments.
- Case result: problem, what you did, number, what you would change. Best for leads.
- Behind the scenes: process of a real project with one photo or clip.
Structure: line 1 is the hook (under 140 chars, shown before "see more"). Blank line after every 1-2 sentences. One idea per post. End with a specific question, not "thoughts?".
Rules: first person, plain words, real details from the video or notes only. No hashtag wall: 3 at the end at most. No links in the body (put in comments). No fake stats. No em dashes.
Format of the answer: the post, then one line saying which kind you used and why.`
  },
  {
    id: 'ask-first', name: 'Ask before you act', appliesTo: ['chat'],
    description: 'The chat asks one clear question with options when something that changes the result is missing.',
    body: `# Ask before you act
- A posting request needs: account or channels, which files, days and times, caption length and tone. If one is missing, ask in ONE message and offer 2-4 options.
- A writing request needs: platform, goal, audience, length. Ask when two or more are missing.
- Never ask what the app already knows (folders, channel names, default times).
- After the user answers, do the task. Do not ask again for the same thing.
- If the request is risky or low value (spam, many posts in minutes, duplicate posts), say so in one line and suggest the safer way.`
  },
  {
    id: 'shorts-reels-script', name: 'Short video script (Shorts, Reels, TikTok)', appliesTo: ['caption', 'chat'],
    description: 'Script structure for 15-60 second vertical videos that keep people watching.',
    body: `# Short video script
Timeline: 0-2s hook (visual plus a line that creates a question). 2-8s promise or context. Middle: 3-5 beats, each one new piece of value, cut every 2-4 seconds. Last 3s: payoff and a reason to comment or follow.
Hook types: curiosity gap, bold claim, "stop doing X", before and after, a number, a mistake story.
Rules: one idea per video. Write for the ear (short sentences). Put on-screen text for the first 2 seconds. Loop the ending back to the hook when possible. Give each beat a time range and what is on screen.
Output: Hook, Beats (with seconds), Ending, Caption, 3 title options, on-screen text lines.`
  },
  {
    id: 'hook-library', name: 'Hook library', appliesTo: ['caption', 'chat'],
    description: 'Proven hook patterns for the first line of any caption or video.',
    body: `# Hook library
Use the pattern that fits the real content. Never claim something the video does not show.
- Curiosity: "Nobody tells you this about [topic]"
- Mistake: "I wasted [time] before I learned this"
- Contrast: "Everyone does [A]. The better way is [B]"
- Number: "[N] things that changed how I [verb]"
- Question: a question the viewer answers in their head
- Pain: name the exact annoyance in the viewer's words
- Result first: show the outcome, then say how
- Pattern interrupt: an odd, specific sentence
Keep hooks under 12 words. Test 3 versions and keep the one with a concrete detail.`
  },
  {
    id: 'youtube-seo', name: 'YouTube titles and descriptions', appliesTo: ['caption', 'chat'],
    description: 'Titles, descriptions and tags that are searchable and still human.',
    body: `# YouTube titles and descriptions
Title: under 70 characters, main keyword in the first half, one clear promise or curiosity, no clickbait the video cannot pay off. Offer 3 options when asked for ideas.
Description: first 2 lines carry the keyword and the promise (shown before "more"). Then 2-3 lines of context, timestamps if long, links, 3 hashtags max.
Tags: 5-10 specific phrases, the exact topic first. Shorts: add #Shorts only if not already in the title.
Thumbnail text: 2-4 words, high contrast, different from the title words.
First comment: a question or a link to the next video.`
  },
  {
    id: 'instagram-captions', name: 'Instagram captions and Reels', appliesTo: ['caption', 'chat'],
    description: 'Reel and post captions: hook in line one, save or share ask, small hashtag set.',
    body: `# Instagram captions
Line 1 is the hook and must work alone (the feed cuts after about 125 characters). Body: short lines with blank spaces. One ask at the end: save, share to a friend, or comment a word.
Hashtags: 3-5 specific tags (niche first, one broad). Put them at the end or in the first comment.
Reels: say what the video shows in a human way, add a keyword people search. Do not repeat the on-screen text word for word.
Carousels: slide 1 promise, last slide ask. Stories: one question sticker per story.
Avoid: "link in bio" spam, tag walls, emoji walls.`
  },
  {
    id: 'tiktok-captions', name: 'TikTok captions', appliesTo: ['caption', 'chat'],
    description: 'Short, searchable TikTok captions with a comment prompt.',
    body: `# TikTok captions
Keep it under 150 characters. Put the search keyword in the first words (TikTok is also a search engine). One question or "comment X" prompt. 2-4 hashtags: one trend or niche tag, one topic tag. Match the sound or trend only if the video really uses it.
Do not repeat the on-screen text. Do not use more than 1 emoji.`
  },
  {
    id: 'facebook-posts', name: 'Facebook posts and Reels', appliesTo: ['caption', 'chat'],
    description: 'Facebook page posts that start conversations and are easy to read on mobile.',
    body: `# Facebook posts
Warm, plain tone. 2-5 short lines. A clear first line, a small story or fact, then a simple question people can answer in one word. 0-2 hashtags. Put links in the first comment when reach matters. Use the person's real language (Bangla or English) and local references.
Avoid: engagement bait like "like if you agree", clickbait with no payoff, all caps.`
  },
  {
    id: 'x-threads', name: 'X posts and threads', appliesTo: ['caption', 'chat'],
    description: 'Single posts under 280 characters and threads with a strong first post.',
    body: `# X posts and threads
Single post: one idea, under 280 characters, no hashtags or one. Thread: post 1 is the promise and hook, then 5-9 posts with one point each, last post recaps and asks for a follow or repost. Number the posts. Use short words and line breaks. No filler openers.`
  },
  {
    id: 'content-calendar', name: 'Content calendar planner', appliesTo: ['chat'],
    description: 'Plan a week or month of posts across channels with themes and slots.',
    body: `# Content calendar planner
Ask: channels, posts per week, niche, goal. Then build a table: day, channel, format (reel, post, carousel, short), theme, hook idea. Mix pillars: 40% value, 30% story, 20% proof or results, 10% offer. Spread formats across the week. Keep the same posting times for 2 weeks, then compare results. Suggest batching: record all videos of one pillar in one session.`
  },
  {
    id: 'repurpose-video', name: 'Repurpose one video everywhere', appliesTo: ['caption', 'chat'],
    description: 'Turn one video into posts for every platform with the right shape for each.',
    body: `# Repurpose one video
From one video produce: a YouTube title and description, a Short or Reel caption, a TikTok caption, a LinkedIn story post, a Facebook post, an X post, and 3 quote lines. Keep the same core idea, change the hook and the length for each platform. Never copy the same text twice. Use only facts from the video.`
  },
  {
    id: 'engagement-replies', name: 'Comment replies', appliesTo: ['chat'],
    description: 'Short human replies to comments, including negative ones.',
    body: `# Comment replies
Reply fast, short, with the person's name or point. Thank without gushing. Answer the question in one line. For criticism: agree with what is fair, give one fact, no argument. For spam or abuse: do not reply, hide or report. Ask one follow-up question to keep the thread alive.`
  },
  {
    id: 'trend-and-timing', name: 'Posting time and consistency', appliesTo: ['chat'],
    description: 'Practical rules for how often and when to post.',
    body: `# Posting time and consistency
Consistency beats volume: pick a pace you can keep (3-5 per week per channel is plenty). Post when the audience is online: check each platform's own analytics, then test two slots for two weeks. Do not post the same video twice to one channel. Do not queue more posts than the channel limit allows. Avoid more than 3 posts in one day on a channel.`
  }
];
