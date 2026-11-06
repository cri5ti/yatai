# yatai
Yet Another Todo App - but with aI


 - very lightweight desktop app


stack?
 - sqlite db probably works best here
 - tauri? or what's even better for native mac/win support?
 - ideally something in typescript / bun / vite space
 - how do we sync into outlook / teams calendar to get meetings?


the 80% case will be a thin window with today's view of what's next:



concepts:
 - project
 - task
 - action - the smallest granular bit of work that we might do



today view:
 - cards of next items
   - e.g. "R&D > extract staff"
   - task as shaded accent 1 > action(s) 


smart items:
 - a github PR: monitors it's status (mergeable, new comments, review feedback; build failures)
 - a devops pipeline : monitors deployment
 - work items : monitor status changes
 - copilot, claude, etc. sessions done / need feedback?
 

monitoring
 - monitor outlook for meeting changes ; show them in "next action" .. move them to the top as time passes; 
 - monitor which app is active to determine if I moved to something else (this is probably challenging, and privacy sensitive... tbd)
 - teams messages; raise awareness of certain bits?


organizer view:
 - project hierarchy, expanding, collapsing, full arrow keys
 - tasks of arbitrary structure and levels

 - meta: created date, last modified, last run, scheduled for - auto driven


inbox view
 - just dump ideas to drag & drop into projects later


focus mode:
 - hide everythihg and start a focus (pomodoro style) to get a chunk of time to do a bit
 - when done can have a quick feedback on what we might want to do next if we switch context


ai:
 - suggest auto organization of inbox
 - plan today
 - auto estimate effort
 - break down a task into actions
  
 - suggest if it can help
 - historical context & learning - e.g. i've done this before like this, suggest the actions
 