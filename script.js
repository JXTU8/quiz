/* =====================================================================
   QUIZ BUILDER — APPLICATION LOGIC
   ---------------------------------------------------------------------
   Table of contents:
     1. State
     2. DOM references
     3. Screen navigation
     4. Creator mode (form handling + question list rendering)
     5. Player mode (loading questions, timer, answer handling)
     6. End screen (scoring + confetti)
     7. Event listeners
     8. Init
   ===================================================================== */

/* ---------------------------------------------------------------------
   1. STATE
   This is the single "source of truth" for the whole app. Every screen
   is just a rendering of this state -- nothing meaningful lives only in
   the DOM. That's the core idea behind the state management here.
--------------------------------------------------------------------- */

// The dynamic array of question objects, built entirely from user input
// in Creator Mode. Each item looks like:
//   { id, questionText, choices: [a, b, c, d], correctAnswerIndex }
let quizQuestions = [];

let currentQuestionIndex = 0; // which question Player Mode is showing
let score = 0;                // correct answers in the current playthrough
let isAnswerLocked = false;   // true while feedback is showing, blocks double answers
let timeLeft = 0;             // seconds left on the current question's timer
let timerIntervalId = null;   // handle returned by setInterval, so we can clearInterval it
let isSoundEnabled = true;    // global sound preference, controlled by the header toggle
let activeMemeAudio = null;   // the currently playing feedback sound, if any
let feedbackTimeoutId = null; // handle for the delayed advance to the next question
let questionTransitionTimeoutId = null;
let endRevealTimeoutId = null;
let scoreRollIntervalId = null;

const TIMER_DURATION = 15;         // seconds allowed per question
const FEEDBACK_TIMING_MS = {
  correct: 3200,
  incorrect: 2800,
  timeout: 3400,
};
const AUDIO_FADE_MS = 450;
const QUESTION_TRANSITION_MS = 420;
const END_REVEAL_MS = 2600;
const DRUMROLL_SOUND_URL = "https://www.myinstants.com/media/sounds/drum-roll-sound-effect.mp3";
const RING_RADIUS = 45;            // must match the SVG circle's r attribute
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const SOUND_STORAGE_KEY = "quiz-builder-sound-enabled";

const memeSounds = {
  correct: [
    "https://www.myinstants.com/media/sounds/taco-bell-bong-sfx.mp3",
    "https://www.myinstants.com/media/sounds/yippee-tbh.mp3",
    "https://www.myinstants.com/media/sounds/anime-wow-sound-effect.mp3",
    "https://www.myinstants.com/media/sounds/mlg-airhorn.mp3",
    "https://www.myinstants.com/media/sounds/s1_c5-online-audio-converter.mp3",
  ],
  incorrect: [
    "https://www.myinstants.com/media/sounds/vine-boom-bass-boost-sound-effect.mp3",
    "https://www.myinstants.com/media/sounds/bruh.mp3",
    "https://www.myinstants.com/media/sounds/emotional-damage-meme.mp3",
    "https://www.myinstants.com/media/sounds/fart-with-reverb.mp3",
    "https://www.myinstants.com/media/sounds/roblox-death-sound_1.mp3",
  ],
  timeout: [
    "https://www.myinstants.com/media/sounds/preview_4.mp3",
    "https://www.myinstants.com/media/sounds/curb-your-enthusiasm.mp3",
    "https://www.myinstants.com/media/sounds/dank-meme-compilation-volume-17_cutted.mp3",
    "https://www.myinstants.com/media/sounds/tindeck_1.mp3",
    "https://www.myinstants.com/media/sounds/sad-trombone.mp3",
  ],
};

const correctMemes = [
  {
    src: "https://media.giphy.com/media/111ebonMs90YLu/giphy.gif",
    caption: "Massive W",
    alt: "Excited approval reaction",
  },
  {
    src: "https://media.giphy.com/media/xT0GqssRweIhlz209i/giphy.gif",
    caption: "Big Brain Energy",
    alt: "Celebration reaction",
  },
  {
    src: "https://media.giphy.com/media/l0HlFZ3c4NENSLQRi/giphy.gif",
    caption: "Cooked Perfectly",
    alt: "Confident celebration reaction",
  },
];

const incorrectMemes = [
  {
    src: "https://media.giphy.com/media/3o7TKQ8kAP0f9X5PoY/giphy.gif",
    caption: "Bruh Moment",
    alt: "Disappointed reaction",
  },
  {
    src: "https://media.giphy.com/media/26ufdipQqU2lhNA4g/giphy.gif",
    caption: "Emotional Damage",
    alt: "Shocked reaction",
  },
  {
    src: "https://media.giphy.com/media/13CoXDiaCcCoyk/giphy.gif",
    caption: "Pain.",
    alt: "Sad reaction",
  },
];

const timeoutMemes = [
  {
    src: "https://media.giphy.com/media/l2JHVUriDGEtWOx0c/giphy.gif",
    caption: "Time's Up",
    alt: "Awkward timeout reaction",
  },
  {
    src: "https://media.giphy.com/media/3o6Zt4HU9uwXmXSAuI/giphy.gif",
    caption: "Clock Got You",
    alt: "Surprised timeout reaction",
  },
];

/* ---------------------------------------------------------------------
   2. DOM REFERENCES
   Cached once up front instead of re-querying the DOM on every call.
--------------------------------------------------------------------- */
const screens = {
  creator: document.getElementById("creator-screen"),
  player: document.getElementById("player-screen"),
  end: document.getElementById("end-screen"),
};
const stepEls = document.querySelectorAll(".step");
const soundToggleBtn = document.getElementById("sound-toggle");
const soundToggleIcon = soundToggleBtn.querySelector(".sound-toggle-icon");
const soundToggleText = soundToggleBtn.querySelector(".sound-toggle-text");

// Creator mode
const questionForm = document.getElementById("question-form");
const questionTextInput = document.getElementById("question-text");
const choiceInputs = [
  document.getElementById("choice-0"),
  document.getElementById("choice-1"),
  document.getElementById("choice-2"),
  document.getElementById("choice-3"),
];
const formErrorEl = document.getElementById("form-error");
const questionListEl = document.getElementById("question-list");
const questionCountEl = document.getElementById("question-count");
const startQuizBtn = document.getElementById("start-quiz-btn");
const startHintEl = document.getElementById("start-hint");

// Player mode
const progressFillEl = document.getElementById("progress-fill");
const questionCounterEl = document.getElementById("question-counter");
const timerWrapperEl = document.getElementById("timer-wrapper");
const timerRingProgressEl = document.getElementById("timer-ring-progress");
const timerTextEl = document.getElementById("timer-text");
const questionTextDisplay = document.getElementById("question-text-display");
const answerButtons = Array.from(document.querySelectorAll(".answer-btn"));
const questionCardEl = document.querySelector(".question-card");
const quizMetaEl = document.querySelector(".quiz-meta");
const memeOverlayEl = document.getElementById("meme-overlay");
const memeOverlayImg = document.getElementById("meme-overlay-img");
const memeOverlayCaption = document.getElementById("meme-overlay-caption");

// End screen
const endCardEl = document.querySelector(".end-card");
const endMessageEl = document.getElementById("end-message");
const endScoreEl = document.getElementById("end-score");
const endPercentageEl = document.getElementById("end-percentage");
const newQuizBtn = document.getElementById("new-quiz-btn");

// Confetti
const confettiContainer = document.getElementById("confetti-container");

/* ---------------------------------------------------------------------
   3. SCREEN NAVIGATION
--------------------------------------------------------------------- */

/**
 * Shows one of the three screens and hides the other two, and updates
 * the "Write / Play / Grade" step indicator to match.
 */
function showScreen(name) {
  Object.entries(screens).forEach(([key, el]) => {
    el.classList.toggle("active", key === name);
  });
  stepEls.forEach((step) => {
    step.classList.toggle("active", step.dataset.step === name);
  });
}

/* ---------------------------------------------------------------------
   4. CREATOR MODE
--------------------------------------------------------------------- */

/**
 * Handles the "Add Question" form submission: reads the fields,
 * validates them, and -- if everything checks out -- builds a plain
 * object and pushes it onto the quizQuestions array. That single push
 * is what "saves" a question; nothing else does.
 */
function handleAddQuestion(event) {
  event.preventDefault();
  clearFormError();

  const questionText = questionTextInput.value.trim();
  const choices = choiceInputs.map((input) => input.value.trim());

  if (!questionText || choices.some((choice) => choice === "")) {
    showFormError("Fill in the question and all four answer choices.");
    return;
  }

  const checkedRadio = questionForm.querySelector('input[name="correct-answer"]:checked');
  if (!checkedRadio) {
    showFormError("Select which answer is correct.");
    return;
  }

  const newQuestion = {
    // crypto.randomUUID is available in modern browsers; the fallback
    // keeps this working even if it isn't.
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    questionText,
    choices,
    correctAnswerIndex: Number(checkedRadio.value),
  };

  quizQuestions.push(newQuestion);

  renderQuestionList();
  updateStartButtonState();

  questionForm.reset();
  questionTextInput.focus();
}

function showFormError(message) {
  formErrorEl.textContent = message;
}

function clearFormError() {
  formErrorEl.textContent = "";
}

/**
 * Rebuilds the "Questions" list from scratch based on quizQuestions.
 * The list is always a direct reflection of the array -- list items are
 * never edited by hand, the whole thing is just re-rendered whenever
 * the array changes.
 */
function renderQuestionList() {
  questionListEl.innerHTML = "";

  if (quizQuestions.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty-state";
    empty.textContent = "No questions yet. Add your first one below.";
    questionListEl.appendChild(empty);
  } else {
    quizQuestions.forEach((question, index) => {
      questionListEl.appendChild(buildQuestionListItem(question, index));
    });
  }

  questionCountEl.textContent = `${quizQuestions.length} added`;
}

/**
 * Builds a single <li> for the question list using safe DOM methods
 * (textContent, not innerHTML) so user-typed text can never be
 * misinterpreted as markup.
 */
function buildQuestionListItem(question, index) {
  const li = document.createElement("li");
  li.className = "question-item";

  const numberEl = document.createElement("span");
  numberEl.className = "question-item-number";
  numberEl.textContent = index + 1;

  const textEl = document.createElement("span");
  textEl.className = "question-item-text";
  textEl.textContent = question.questionText;

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "question-item-delete";
  deleteBtn.textContent = "\u00D7"; // ×
  deleteBtn.dataset.id = question.id;
  deleteBtn.setAttribute("aria-label", `Delete question ${index + 1}`);

  li.append(numberEl, textEl, deleteBtn);
  return li;
}

/**
 * Event delegation: one listener on the list container figures out
 * which delete button was clicked, rather than attaching a listener to
 * every single item. This keeps working automatically as items are
 * added and removed.
 */
function handleQuestionListClick(event) {
  const deleteBtn = event.target.closest(".question-item-delete");
  if (!deleteBtn) return;

  const id = deleteBtn.dataset.id;
  quizQuestions = quizQuestions.filter((question) => question.id !== id);

  renderQuestionList();
  updateStartButtonState();
}

/** Enables "Start Quiz" only once there's at least one question. */
function updateStartButtonState() {
  const hasQuestions = quizQuestions.length > 0;
  startQuizBtn.disabled = !hasQuestions;
  startHintEl.style.visibility = hasQuestions ? "hidden" : "visible";
}

/* ---------------------------------------------------------------------
   5. PLAYER MODE
--------------------------------------------------------------------- */

function handleStartQuiz() {
  if (quizQuestions.length === 0) return;

  currentQuestionIndex = 0;
  score = 0;
  setProgress(0);

  showScreen("player");
  loadQuestion();
}

/**
 * Renders quizQuestions[currentQuestionIndex] into the player screen.
 * This is the "loop through the array" step: Player Mode keeps no copy
 * of question data of its own, it just reads whatever the array holds
 * at the current index.
 */
function loadQuestion() {
  isAnswerLocked = false;
  const question = quizQuestions[currentQuestionIndex];

  questionCardEl.classList.remove("question-exit", "question-enter");
  quizMetaEl.classList.remove("meta-pop");

  questionTextDisplay.textContent = question.questionText;
  questionCounterEl.textContent = `Question ${currentQuestionIndex + 1} of ${quizQuestions.length}`;

  answerButtons.forEach((button, i) => {
    button.querySelector(".answer-text").textContent = question.choices[i];
    button.className = "answer-btn"; // clears any leftover correct/incorrect class
    button.style.setProperty("--answer-order", i);
    button.disabled = false;
  });

  void questionCardEl.offsetWidth;
  questionCardEl.classList.add("question-enter");
  quizMetaEl.classList.add("meta-pop");

  // Note: the progress bar is deliberately NOT updated here. It only
  // advances once a question is answered (see revealAnswer's callers
  // below), so it always reflects "questions completed," not "question
  // currently on screen."

  startTimer();
}

function startTimer() {
  clearInterval(timerIntervalId);
  timeLeft = TIMER_DURATION;
  timerWrapperEl.classList.remove("timer-low");

  // Reset the ring to "full" instantly, with no animation, before the
  // countdown begins. Without this, the ring would visibly animate from
  // last question's near-empty state back up to full, which reads as a
  // glitch rather than a clean reset for the new question.
  timerRingProgressEl.style.transition = "none";
  updateTimerVisual();
  void timerRingProgressEl.offsetWidth; // forces the browser to apply the style above immediately
  timerRingProgressEl.style.transition = "";

  timerIntervalId = setInterval(() => {
    timeLeft -= 1;
    updateTimerVisual();

    if (timeLeft <= 0) {
      clearInterval(timerIntervalId);
      handleTimeUp();
    }
  }, 1000);
}

function stopTimer() {
  clearInterval(timerIntervalId);
}

function updateTimerVisual() {
  timerTextEl.textContent = timeLeft;

  const offset = RING_CIRCUMFERENCE * (1 - timeLeft / TIMER_DURATION);
  timerRingProgressEl.style.strokeDashoffset = offset;

  timerWrapperEl.classList.toggle("timer-low", timeLeft <= 5);
}

/** Called when the player clicks one of the four answer buttons. */
function handleAnswerClick(event) {
  if (isAnswerLocked) return;
  isAnswerLocked = true;
  stopTimer();

  const selectedIndex = Number(event.currentTarget.dataset.index);
  const question = quizQuestions[currentQuestionIndex];
  const isCorrect = selectedIndex === question.correctAnswerIndex;

  if (isCorrect) {
    score += 1;
  }

  const feedbackType = isCorrect ? "correct" : "incorrect";
  const feedbackDuration = getFeedbackDuration(feedbackType);

  playMemeSound(feedbackType, feedbackDuration);
  showMemeReaction(feedbackType, feedbackDuration);
  revealAnswer(selectedIndex, question.correctAnswerIndex);
  setProgress((currentQuestionIndex + 1) / quizQuestions.length);

  scheduleAdvance(feedbackDuration);
}

/** Called automatically if the 15-second timer reaches zero unanswered. */
function handleTimeUp() {
  if (isAnswerLocked) return;
  isAnswerLocked = true;

  const question = quizQuestions[currentQuestionIndex];

  const feedbackDuration = getFeedbackDuration("timeout");

  playMemeSound("timeout", feedbackDuration);
  showMemeReaction("timeout", feedbackDuration);
  revealAnswer(null, question.correctAnswerIndex); // null = nothing was selected
  setProgress((currentQuestionIndex + 1) / quizQuestions.length);

  scheduleAdvance(feedbackDuration);
}

/** Colors the correct answer green, and a wrong selection red + shaking. */
function revealAnswer(selectedIndex, correctIndex) {
  answerButtons.forEach((button, i) => {
    button.disabled = true;
    if (i === correctIndex) {
      button.classList.add("correct");
    } else if (i === selectedIndex) {
      button.classList.add("incorrect");
    } else {
      button.classList.add("dimmed");
    }
  });
}

function playMemeSound(type, durationMs) {
  stopActiveMemeAudio();
  if (!isSoundEnabled) return;

  const soundUrl = pickRandom(memeSounds[type]);
  if (!soundUrl) return;

  const audio = new Audio(soundUrl);
  activeMemeAudio = audio;
  audio.volume = type === "timeout" ? 0.72 : 0.85;

  const fadeStartDelay = Math.max(0, durationMs - AUDIO_FADE_MS);
  setTimeout(() => fadeOutAndStopAudio(audio), fadeStartDelay);

  audio.play().catch(() => {
    // Browsers may block autoplay-like audio, especially if the timer expires
    // before the first direct interaction. Failing silently keeps the quiz flow smooth.
  });
}

function fadeOutAndStopAudio(audio) {
  if (!audio || audio.paused) return;

  const startingVolume = audio.volume;
  const fadeSteps = 12;
  const stepMs = AUDIO_FADE_MS / fadeSteps;
  let step = 0;

  const fadeIntervalId = setInterval(() => {
    step += 1;
    audio.volume = Math.max(0, startingVolume * (1 - step / fadeSteps));

    if (step >= fadeSteps) {
      clearInterval(fadeIntervalId);
      audio.pause();
      audio.currentTime = 0;
      if (activeMemeAudio === audio) activeMemeAudio = null;
    }
  }, stepMs);
}

function stopActiveMemeAudio() {
  if (!activeMemeAudio) return;
  activeMemeAudio.pause();
  activeMemeAudio.currentTime = 0;
  activeMemeAudio = null;
}

function showMemeReaction(type, durationMs) {
  const memeMap = {
    correct: correctMemes,
    incorrect: incorrectMemes,
    timeout: timeoutMemes,
  };
  const meme = pickRandom(memeMap[type]);
  if (!meme) return;

  memeOverlayImg.src = meme.src;
  memeOverlayImg.alt = meme.alt;
  memeOverlayCaption.textContent = meme.caption;
  memeOverlayEl.setAttribute("aria-hidden", "false");
  memeOverlayEl.style.setProperty("--meme-duration", `${durationMs}ms`);

  memeOverlayEl.classList.remove("show");
  void memeOverlayEl.offsetWidth; // restart the pop animation for rapid consecutive answers
  memeOverlayEl.classList.add("show");
}

function hideMemeReaction() {
  memeOverlayEl.classList.remove("show");
  memeOverlayEl.setAttribute("aria-hidden", "true");
  memeOverlayImg.src = "";
  memeOverlayImg.alt = "";
  memeOverlayCaption.textContent = "";
}

function pickRandom(items) {
  if (!items || items.length === 0) return null;
  return items[Math.floor(Math.random() * items.length)];
}

function getFeedbackDuration(type) {
  return FEEDBACK_TIMING_MS[type] || FEEDBACK_TIMING_MS.incorrect;
}

function scheduleAdvance(delayMs) {
  clearTimeout(feedbackTimeoutId);
  feedbackTimeoutId = setTimeout(advanceToNextQuestion, delayMs);
}

function loadSoundPreference() {
  const savedPreference = localStorage.getItem(SOUND_STORAGE_KEY);
  isSoundEnabled = savedPreference === null ? true : savedPreference === "true";
}

function saveSoundPreference() {
  localStorage.setItem(SOUND_STORAGE_KEY, String(isSoundEnabled));
}

function updateSoundToggleVisual() {
  soundToggleBtn.setAttribute("aria-pressed", String(isSoundEnabled));
  soundToggleIcon.textContent = isSoundEnabled ? "🔊" : "🔇";
  soundToggleText.textContent = isSoundEnabled ? "Sound: ON" : "Sound: OFF";
  soundToggleBtn.setAttribute(
    "aria-label",
    isSoundEnabled ? "Turn quiz sound off" : "Turn quiz sound on"
  );
}

function handleSoundToggleClick() {
  isSoundEnabled = !isSoundEnabled;
  saveSoundPreference();
  updateSoundToggleVisual();
}

function setProgress(fraction) {
  const percent = Math.min(100, Math.max(0, fraction * 100));
  progressFillEl.style.width = `${percent}%`;
}

function advanceToNextQuestion() {
  stopActiveMemeAudio();
  hideMemeReaction();
  currentQuestionIndex += 1;

  if (currentQuestionIndex >= quizQuestions.length) {
    showEndScreen();
  } else {
    questionCardEl.classList.remove("question-enter");
    questionCardEl.classList.add("question-exit");
    clearTimeout(questionTransitionTimeoutId);
    questionTransitionTimeoutId = setTimeout(loadQuestion, QUESTION_TRANSITION_MS);
  }
}

/* ---------------------------------------------------------------------
   6. END SCREEN
--------------------------------------------------------------------- */

function showEndScreen() {
  showScreen("end");

  const total = quizQuestions.length;
  const percentage = Math.round((score / total) * 100);

  clearEndRevealTimers();
  endCardEl.classList.remove("score-revealed");
  endCardEl.classList.add("is-revealing");
  endScoreEl.textContent = `? / ${total}`;
  endPercentageEl.textContent = "Drum roll...";
  endMessageEl.textContent = "Calculating your academic aura.";
  newQuizBtn.disabled = true;

  playRevealDrumroll();
  animateScoreRoll(score, total, percentage);

  endRevealTimeoutId = setTimeout(() => revealFinalScore(score, total, percentage), END_REVEAL_MS);
}

function animateScoreRoll(finalScore, total, percentage) {
  let ticks = 0;
  const maxTicks = 18;

  scoreRollIntervalId = setInterval(() => {
    ticks += 1;
    const fakeScore = Math.floor(Math.random() * (total + 1));
    const fakePercent = Math.floor(Math.random() * 101);

    endScoreEl.textContent = `${fakeScore} / ${total}`;
    endPercentageEl.textContent = `${fakePercent}%`;

    if (ticks >= maxTicks) {
      clearInterval(scoreRollIntervalId);
      scoreRollIntervalId = null;
      endScoreEl.textContent = `${finalScore} / ${total}`;
      endPercentageEl.textContent = `${percentage}%`;
    }
  }, 95);
}

function revealFinalScore(finalScore, total, percentage) {
  clearEndRevealTimers();
  endCardEl.classList.remove("is-revealing");
  endCardEl.classList.add("score-revealed");
  endScoreEl.textContent = `${finalScore} / ${total}`;
  endPercentageEl.textContent = `${percentage}%`;
  endMessageEl.textContent = getScoreMessage(percentage);
  newQuizBtn.disabled = false;

  if (percentage > 80) {
    launchConfetti();
  }
}

function playRevealDrumroll() {
  stopActiveMemeAudio();
  if (!isSoundEnabled) return;

  const audio = new Audio(DRUMROLL_SOUND_URL);
  activeMemeAudio = audio;
  audio.volume = 0.75;
  setTimeout(() => fadeOutAndStopAudio(audio), Math.max(0, END_REVEAL_MS - AUDIO_FADE_MS));
  audio.play().catch(() => {});
}

function clearEndRevealTimers() {
  clearTimeout(endRevealTimeoutId);
  if (scoreRollIntervalId) {
    clearInterval(scoreRollIntervalId);
    scoreRollIntervalId = null;
  }
}

function getScoreMessage(percentage) {
  if (percentage === 100) return "Perfect score.";
  if (percentage > 80) return "Excellent work.";
  if (percentage >= 50) return "Solid effort.";
  return "Keep practicing.";
}

/**
 * A lightweight, dependency-free confetti effect: spawn a burst of small
 * colored divs at random horizontal positions, let a CSS keyframe
 * animation carry them down the screen, then remove each one once its
 * own animation finishes so the DOM doesn't accumulate leftover nodes.
 */
function launchConfetti() {
  const colors = [
    "var(--clr-blue)",
    "var(--clr-green)",
    "var(--clr-red)",
    "#c98a1e",
  ];
  const pieceCount = 140;

  for (let i = 0; i < pieceCount; i++) {
    const piece = document.createElement("div");
    piece.className = "confetti-piece";
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDuration = `${2.5 + Math.random() * 1.5}s`;
    piece.style.animationDelay = `${Math.random() * 0.4}s`;
    if (Math.random() > 0.5) piece.style.borderRadius = "50%";

    piece.addEventListener("animationend", () => piece.remove());
    confettiContainer.appendChild(piece);
  }
}

function handleCreateNewQuiz() {
  clearTimeout(feedbackTimeoutId);
  clearTimeout(questionTransitionTimeoutId);
  clearEndRevealTimers();
  stopActiveMemeAudio();
  quizQuestions = [];
  currentQuestionIndex = 0;
  score = 0;
  confettiContainer.innerHTML = ""; // clear out any leftover confetti pieces

  renderQuestionList();
  updateStartButtonState();
  showScreen("creator");
}

/* ---------------------------------------------------------------------
   7. EVENT LISTENERS
--------------------------------------------------------------------- */
questionForm.addEventListener("submit", handleAddQuestion);
questionListEl.addEventListener("click", handleQuestionListClick);
startQuizBtn.addEventListener("click", handleStartQuiz);
soundToggleBtn.addEventListener("click", handleSoundToggleClick);
answerButtons.forEach((button) => button.addEventListener("click", handleAnswerClick));
newQuizBtn.addEventListener("click", handleCreateNewQuiz);

/* ---------------------------------------------------------------------
   8. INIT
   The <script> tag uses `defer`, so the DOM is already fully parsed by
   the time this file runs -- no DOMContentLoaded listener needed.
--------------------------------------------------------------------- */
function init() {
  loadSoundPreference();
  updateSoundToggleVisual();
  renderQuestionList();
  updateStartButtonState();
  showScreen("creator");
}

init();
