
main shell:
 - no logo
 - cmd+1/2/3 to switch the main tabs
 - today => next


I want a clear focus ring, arrows to easily navigate all UI, .. everything has to be asily accessible by keyboard with reasonable shortcuts


in every place I should be able to create new things on the spot

cmd+enter to insert new things on the spot
 - enter / escape in blank field cancels creation


cmd+up/down to reorder things (with animation); or drag.. 


actions are linked to tasks 
dragging action inside a task just reorders actions inside

top level arrows move across tasks
pressing right arrow moves inside the task actions list and same up / down arrow cmd+up/down, cmd+enter to move, reoder, insert;  left arrow goes back to project level

can also drag actions outside of the project, 
that will just split the schedule.. same project still, but moves actions later


enter key on an action starts the action

enter on project starts the first action

space toggles done / not done, but it's just a visual marker, nothing disapears

starting moves the projetc / action to the top of the stack

actions can be multi line, but only first line is visible normally; lines 2+ have a smaller font;
a basic markdown is supported with: bold, italic, urls, lists, checkboxes

starting the current task expands the action text (animateed)
or pressing right arrow also expands
left arrow collapses it back

a full task can also be collapsed

when a task is split into multiple schedules, the others will have a tiny marker to highlight them;

a right click context menu at each level with the various supoprted actions, including a "Consolidate" with tooltip: "Consolidate all your actions here"
context menu also shows with "/" key and includes a input box to type commands ,to reduce, e.g. /consolidate, /abandon, /due, /reschedule, /tomorrow, /ai, /duplicate


add an undo/redo manager so every action passes through this

have a sweet animation and accept for current started action

create design tokens to make the design consistent



meetings in the day behave mostly the same as tasks, they are items in the agenda, can be moved, can add actions inside, e.g. "prep" .. but they have a fixed action inside that the text can't be changed with a "calendar" icon.


when an action is started, it shows a ongoing stopwatch

actions can have a estimated duration (/estimate => with a submenu of few options with shortcut keys 1=5 min, 2=15min, 3=30min,4=1h,5=2h,6=4h,8=8h); shift+left/right scrolls through est time;

cmd+enter starts the task in focus mode

cmd+/ opens ai mode (we'll get to this later; just add a tiny input popup box that you can type a text and a mocked reply / conversation UI that can be closed with esc key)

