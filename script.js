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
let streak = 0;               // consecutive correct answers
let isPlaying = false;        // true if a quiz is in progress
let isAnswerLocked = false;   // true while feedback is showing, blocks double answers
let timeLeft = 0;             // seconds left on the current question's timer
let timerIntervalId = null;   // handle returned by setInterval, so we can clearInterval it
let isSoundEnabled = true;    // global sound preference, controlled by the header toggle
let activeMemeAudio = null;   // the currently playing feedback sound, if any
let drumrollAudio = null;     // preloaded result reveal sound (fallback path)
let audioFadeTimeoutId = null;
let audioFadeIntervalId = null;
let drumrollPrimeToken = 0;
let revealAudioContext = null;
let drumrollAudioBuffer = null;      // decoded PCM samples -- the real zero-latency path
let drumrollBufferPromise = null;    // in-flight fetch+decode, so we never kick it off twice
let drumrollBufferSourceNode = null; // the currently playing buffer source, if any
let drumrollGainNode = null;         // its gain node, so fade-out/stop can reach it
let computedRevealDelayMs = null;         // detected hit time -> drives the reveal; null until analyzed
let drumrollPlaybackStartSeconds = null;  // detected lead-in trim; null until analyzed (see getDrumrollPlaybackStartSeconds)
let feedbackTimeoutId = null; // handle for the delayed advance to the next question
let questionTransitionTimeoutId = null;
let endRevealTimeoutId = null;
let scoreRollIntervalId = null;
let endRevealMessageIntervalId = null;

const TIMER_DURATION = 15;         // seconds allowed per question
const FEEDBACK_TIMING_MS = {
  correct: 3200,
  incorrect: 2800,
  timeout: 3400,
};
const AUDIO_FADE_MS = 450;
const QUESTION_TRANSITION_MS = 420;
const END_REVEAL_MS = 3700; // fallback reveal delay, used only if we can't analyze the buffer
const DRUMROLL_SOUND_URL = "https://www.myinstants.com/media/sounds/bb-drum-roll.mp3";
// Fallback-only lead-in trim for the <audio>-element path, which can't inspect
// raw samples the way the AudioBuffer path below can. Left at 0 (no trim) on
// purpose: we have no measured silence length for this specific file, and
// guessing a number tuned for a different file risks clipping real content
// instead of just leaving a little extra silence at the very start.
const DRUMROLL_START_OFFSET_SECONDS = 0;
const RING_RADIUS = 45;            // must match the SVG circle's r attribute
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const SOUND_STORAGE_KEY = "quiz-builder-sound-enabled";
const END_REVEAL_MESSAGES = [
  "Lights down. Grade incoming.",
  "Locking in the final tally.",
  "Consulting the scoreboard.",
  "Preparing the big reveal.",
];

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
const streakContainerEl = document.getElementById("streak-container");
const streakTextEl = document.getElementById("streak-text");
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
  playClick();

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
  saveState();

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
  playClick();

  const id = deleteBtn.dataset.id;
  quizQuestions = quizQuestions.filter((question) => question.id !== id);

  renderQuestionList();
  updateStartButtonState();
  saveState();
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
  playClick();

  currentQuestionIndex = 0;
  score = 0;
  streak = 0;
  isPlaying = true;
  saveState();
  setProgress(0);
  preloadDrumrollAudio();
  primeRevealAudio();
  loadDrumrollAudioBuffer();

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

  if (currentQuestionIndex === quizQuestions.length - 1) {
    // This question's ~15s timer is the last runway before the reveal.
    // Re-attempt the buffer decode (in case it hasn't finished, or the
    // first attempt failed) and re-run the muted <audio> prime -- on a
    // longer quiz, the priming done once back at handleStartQuiz() can
    // go cold by now, and this is the last chance to warm it up before
    // it actually needs to be instant.
    loadDrumrollAudioBuffer();
    primeDrumrollAudio();
  }

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
    streak += 1;
    playCorrectSound();
  } else {
    streak = 0;
    playWrongSound();
  }

  updateStreakVisual();

  saveState();

  const feedbackType = isCorrect ? "correct" : "incorrect";
  const feedbackDuration = getFeedbackDuration(feedbackType);
  const isFinalQuestion = currentQuestionIndex === quizQuestions.length - 1;

  const feedbackAudio = playMemeSound(feedbackType, feedbackDuration, {
    fade: !isFinalQuestion,
  });
  showMemeReaction(feedbackType, feedbackDuration);
  revealAnswer(selectedIndex, question.correctAnswerIndex);
  setProgress((currentQuestionIndex + 1) / quizQuestions.length);

  scheduleAdvanceAfterFeedback(feedbackDuration, feedbackAudio);
}

/** Called automatically if the 15-second timer reaches zero unanswered. */
function handleTimeUp() {
  if (isAnswerLocked) return;
  isAnswerLocked = true;

  const question = quizQuestions[currentQuestionIndex];

  const feedbackDuration = getFeedbackDuration("timeout");
  streak = 0;
  updateStreakVisual();
  saveState();
  playWrongSound();

  const isFinalQuestion = currentQuestionIndex === quizQuestions.length - 1;

  const feedbackAudio = playMemeSound("timeout", feedbackDuration, {
    fade: !isFinalQuestion,
  });
  showMemeReaction("timeout", feedbackDuration);
  revealAnswer(null, question.correctAnswerIndex); // null = nothing was selected
  setProgress((currentQuestionIndex + 1) / quizQuestions.length);

  scheduleAdvanceAfterFeedback(feedbackDuration, feedbackAudio);
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

function playMemeSound(type, durationMs, options = {}) {
  stopActiveMemeAudio();
  if (!isSoundEnabled) return null;

  const soundUrl = pickRandom(memeSounds[type]);
  if (!soundUrl) return null;

  const audio = new Audio(soundUrl);
  activeMemeAudio = audio;
  audio.volume = type === "timeout" ? 0.72 : 0.85;

  if (options.fade !== false) {
    const fadeStartDelay = Math.max(0, durationMs - AUDIO_FADE_MS);
    scheduleAudioFadeOut(audio, fadeStartDelay);
  }

  audio.play().catch(() => {
    // Browsers may block autoplay-like audio, especially if the timer expires
    // before the first direct interaction. Failing silently keeps the quiz flow smooth.
    handleAudioPlayFailure(audio);
  });

  return audio;
}

function handleAudioPlayFailure(audio) {
  if (activeMemeAudio !== audio) return;
  clearAudioFadeTimers();
  audio.pause();
  if (audio === drumrollAudio) {
    seekAudioToDrumrollStart(audio);
  } else {
    audio.currentTime = 0;
  }
  activeMemeAudio = null;
}

function scheduleAudioFadeOut(audio, delayMs) {
  clearAudioFadeTimers();
  audioFadeTimeoutId = setTimeout(() => fadeOutAndStopAudio(audio), delayMs);
}

function clearAudioFadeTimers() {
  clearTimeout(audioFadeTimeoutId);
  clearInterval(audioFadeIntervalId);
  audioFadeTimeoutId = null;
  audioFadeIntervalId = null;
}

function fadeOutAndStopAudio(audio) {
  audioFadeTimeoutId = null;

  if (!audio || audio.paused) {
    if (activeMemeAudio === audio) activeMemeAudio = null;
    return;
  }

  clearInterval(audioFadeIntervalId);

  const startingVolume = audio.volume;
  const fadeSteps = 12;
  const stepMs = AUDIO_FADE_MS / fadeSteps;
  let step = 0;

  audioFadeIntervalId = setInterval(() => {
    step += 1;
    audio.volume = Math.max(0, startingVolume * (1 - step / fadeSteps));

    if (step >= fadeSteps) {
      clearInterval(audioFadeIntervalId);
      audioFadeIntervalId = null;
      audio.pause();
      if (audio === drumrollAudio) {
        seekAudioToDrumrollStart(audio);
      } else {
        audio.currentTime = 0;
      }
      if (activeMemeAudio === audio) activeMemeAudio = null;
    }
  }, stepMs);
}

function stopActiveMemeAudio() {
  clearAudioFadeTimers();
  stopDrumrollBufferSource();
  if (!activeMemeAudio) return;
  activeMemeAudio.pause();
  if (activeMemeAudio === drumrollAudio) {
    seekAudioToDrumrollStart(activeMemeAudio);
  } else {
    activeMemeAudio.currentTime = 0;
  }
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

function scheduleAdvanceAfterFeedback(delayMs, feedbackAudio) {
  const isFinalQuestion = currentQuestionIndex === quizQuestions.length - 1;
  if (!isFinalQuestion || !feedbackAudio) {
    scheduleAdvance(delayMs);
    return;
  }

  clearTimeout(feedbackTimeoutId);
  feedbackTimeoutId = setTimeout(advanceToNextQuestion, delayMs + 1200);

  feedbackAudio.addEventListener("ended", () => {
    clearTimeout(feedbackTimeoutId);
    advanceToNextQuestion();
  }, { once: true });
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
  if (!isSoundEnabled) {
    stopActiveMemeAudio();
  } else {
    preloadDrumrollAudio();
    primeRevealAudio();
  }
  saveSoundPreference();
  updateSoundToggleVisual();
}

function setProgress(fraction) {
  const percent = Math.min(100, Math.max(0, fraction * 100));
  progressFillEl.style.width = `${percent}%`;
}

function updateStreakVisual() {
  if (!streakContainerEl || !streakTextEl) return;

  streakTextEl.textContent = streak;

  if (streak > 0) {
    streakContainerEl.classList.add("active");
    if (streak >= 3) {
      streakContainerEl.classList.add("on-fire");
    } else {
      streakContainerEl.classList.remove("on-fire");
    }
  } else {
    streakContainerEl.classList.remove("active", "on-fire");
  }
}

function advanceToNextQuestion() {
  stopActiveMemeAudio();
  hideMemeReaction();
  currentQuestionIndex += 1;
  setProgress((currentQuestionIndex) / quizQuestions.length);
  saveState();

  if (currentQuestionIndex >= quizQuestions.length) {
    playRevealDrumroll();
    requestAnimationFrame(showEndScreen);
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
  isPlaying = false;
  clearState();
  const total = quizQuestions.length;
  const percentage = Math.round((score / total) * 100);
  const revealDelayMs = getRevealDelayMs();

  clearEndRevealTimers();
  showScreen("end");

  endCardEl.classList.remove("score-revealed");
  endCardEl.classList.add("is-revealing");
  endScoreEl.textContent = `? / ${total}`;
  endPercentageEl.textContent = "Rolling...";
  endMessageEl.textContent = END_REVEAL_MESSAGES[0];
  newQuizBtn.disabled = true;

  scheduleRevealMessages(revealDelayMs);
  animateScoreRoll(score, total, percentage, revealDelayMs);

  endRevealTimeoutId = setTimeout(() => revealFinalScore(score, total, percentage), revealDelayMs);
}

function animateScoreRoll(finalScore, total, percentage, revealDelayMs) {
  let ticks = 0;
  const tickMs = 70;
  const maxTicks = Math.ceil(revealDelayMs / tickMs);

  rollScoreTick();
  scoreRollIntervalId = setInterval(() => {
    rollScoreTick();
  }, tickMs);

  function rollScoreTick() {
    ticks += 1;
    const intensity = ticks / maxTicks;
    const drift = Math.max(1, Math.ceil(total * (1 - intensity)));
    const fakeScore = Math.min(total, Math.max(0, finalScore + randomInt(-drift, drift)));
    const percentDrift = Math.max(3, Math.ceil(45 * (1 - intensity)));
    const fakePercent = Math.min(100, Math.max(0, percentage + randomInt(-percentDrift, percentDrift)));

    endScoreEl.textContent = `${fakeScore} / ${total}`;
    endPercentageEl.textContent = `${fakePercent}%`;

    if (ticks >= maxTicks) {
      clearInterval(scoreRollIntervalId);
      scoreRollIntervalId = null;
    }
  }
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function scheduleRevealMessages(revealDelayMs) {
  let messageIndex = 0;
  clearInterval(endRevealMessageIntervalId);
  const messageIntervalMs = Math.max(400, revealDelayMs / END_REVEAL_MESSAGES.length);
  endRevealMessageIntervalId = setInterval(() => {
    messageIndex = Math.min(messageIndex + 1, END_REVEAL_MESSAGES.length - 1);
    endMessageEl.textContent = END_REVEAL_MESSAGES[messageIndex];
    if (messageIndex >= END_REVEAL_MESSAGES.length - 1) {
      clearInterval(endRevealMessageIntervalId);
      endRevealMessageIntervalId = null;
    }
  }, messageIntervalMs);
}

function revealFinalScore(finalScore, total, percentage) {
  clearEndRevealTimers();
  endCardEl.classList.remove("is-revealing");
  endCardEl.classList.add("score-revealed");
  endScoreEl.textContent = `${finalScore} / ${total}`;
  endPercentageEl.textContent = `${percentage}%`;
  endMessageEl.textContent = getScoreMessage(percentage);
  newQuizBtn.disabled = false;
  playRevealImpactSound();

  if (percentage > 80) {
    launchConfetti();
    playConfettiExplosionSound();
  }
}

function playRevealDrumroll() {
  stopActiveMemeAudio();
  if (!isSoundEnabled) return;

  drumrollPrimeToken += 1;

  // The decoded AudioBuffer is the actual fix for the startup gap: once
  // decodeAudioData() has finished, every sample already sits in memory,
  // so starting it is a synchronous, sample-accurate call with no network
  // fetch and no seek to wait on. Seeking an <audio> element (the old
  // path, kept below) can never fully close that gap, because seeking a
  // compressed stream is itself an async decode operation -- it only
  // looks synchronous. Only fall back to <audio> if the buffer never
  // finished loading (slow network, or the host doesn't send CORS
  // headers, so decodeAudioData() couldn't read the bytes).
  if (drumrollAudioBuffer) {
    playDrumrollFromBuffer(drumrollAudioBuffer);
  } else {
    playFallbackDrumrollAudio();
  }
}

function getDrumrollAudio() {
  if (!drumrollAudio) {
    preloadDrumrollAudio();
  }
  return drumrollAudio;
}

function preloadDrumrollAudio() {
  if (drumrollAudio) return;

  drumrollAudio = new Audio(DRUMROLL_SOUND_URL);
  drumrollAudio.preload = "auto";
  drumrollAudio.load();
  // Park it at the trimmed start point now, while nothing is waiting on
  // it, instead of seeking right before play() at reveal time -- that's
  // what was causing the audible gap before the drumroll sound started.
  seekAudioToDrumrollStart(drumrollAudio);
}

/**
 * Fetches and decodes the drumroll mp3 into a raw AudioBuffer -- this is
 * what actually fixes the startup delay (see the comment in
 * playRevealDrumroll for why seeking an <audio> element can't). Kicked
 * off as early as possible (page load, and again at quiz start and at
 * the final question as safety-net retries) so decoding has the whole
 * session to finish long before it's ever needed. Safe to call more than
 * once: it no-ops once a buffer exists or a decode is already in flight.
 */
function loadDrumrollAudioBuffer() {
  if (drumrollAudioBuffer || drumrollBufferPromise) return drumrollBufferPromise;

  const audioContext = getRevealAudioContext();
  if (!audioContext) return null;

  drumrollBufferPromise = fetch(DRUMROLL_SOUND_URL, { mode: "cors", credentials: "omit" })
    .then((response) => {
      if (!response.ok) throw new Error(`Drumroll fetch failed: ${response.status}`);
      return response.arrayBuffer();
    })
    .then((arrayBuffer) => audioContext.decodeAudioData(arrayBuffer))
    .then((decodedBuffer) => {
      drumrollAudioBuffer = decodedBuffer;
      analyzeDrumrollBuffer(decodedBuffer);
      return decodedBuffer;
    })
    .catch((error) => {
      // Cross-origin fetch/decode can fail for reasons outside our
      // control -- no CORS headers from the host, a network hiccup, a
      // format decodeAudioData() rejects. That's fine: playRevealDrumroll
      // falls back to the pre-seeked <audio> element, it just won't have
      // the zero-latency guarantee. Reset the promise so a later retry
      // (e.g. at the final question) can try again instead of being
      // stuck on this rejected one forever.
      console.warn("Drumroll AudioBuffer unavailable, using <audio> fallback instead:", error);
      drumrollBufferPromise = null;
      return null;
    });

  return drumrollBufferPromise;
}

/**
 * This is the "listening" the code does instead of me: once decodeAudioData()
 * hands back raw PCM samples, scan them for (1) where real content starts
 * (skip any near-silent lead-in) and (2) the loudest sudden jump in volume --
 * the "hit"/crash/explosion at the end of a drumroll build-up. Whatever it
 * finds drives the actual reveal timing below instead of a fixed guess.
 */
function analyzeDrumrollBuffer(buffer) {
  try {
    const startSeconds = findLeadingSilenceEndSeconds(buffer);
    drumrollPlaybackStartSeconds = startSeconds;

    const hitSeconds = findLoudestTransientSeconds(buffer);
    if (hitSeconds !== null && hitSeconds > startSeconds) {
      const delayFromPlaybackStartMs = (hitSeconds - startSeconds) * 1000;
      // Clamp to a sane range regardless of what the analysis finds: too
      // short and the score-roll has no time to feel like anything, too
      // long and the reveal just feels stuck. 1.2s-6s covers any
      // reasonable drumroll-into-hit clip.
      computedRevealDelayMs = Math.min(6000, Math.max(1200, Math.round(delayFromPlaybackStartMs)));
      console.info(`Drumroll analysis: playback starts at ${startSeconds.toFixed(2)}s, hit detected at ${hitSeconds.toFixed(2)}s -> reveal in ${computedRevealDelayMs}ms`);
    } else {
      console.warn("Drumroll analysis: no clear transient found, using the fixed fallback reveal timing instead.");
    }
  } catch (error) {
    // Analysis is a bonus on top of a working drumroll, not a
    // requirement -- if it throws for any reason, just keep the fixed
    // fallback timing rather than breaking the reveal entirely.
    console.warn("Drumroll analysis failed, using the fixed fallback reveal timing instead:", error);
  }
}

/**
 * Finds when real audio content begins, in seconds, by scanning short
 * windows for the first one whose loudness clears a threshold relative to
 * the clip's own peak. Returns 0 if the buffer is silent throughout (i.e.
 * "nothing to trim") or too short to analyze meaningfully.
 */
function findLeadingSilenceEndSeconds(buffer) {
  const data = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const windowSize = Math.max(1, Math.round(sampleRate * 0.01)); // 10ms windows
  const windowCount = Math.floor(data.length / windowSize);
  if (windowCount < 2) return 0;

  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    const abs = Math.abs(data[i]);
    if (abs > peak) peak = abs;
  }
  if (peak < 0.001) return 0; // effectively silent clip -- nothing to skip past

  // 2.5% of the clip's peak: low enough to catch a quiet buildup near its
  // true onset (not just once it's already ramped partway to full volume),
  // high enough to stay above genuine digital silence / encoder noise floor.
  const threshold = peak * 0.025;
  for (let w = 0; w < windowCount; w++) {
    const start = w * windowSize;
    let sumSquares = 0;
    for (let i = start; i < start + windowSize; i++) sumSquares += data[i] * data[i];
    if (Math.sqrt(sumSquares / windowSize) > threshold) {
      return start / sampleRate;
    }
  }
  return 0;
}

/**
 * Finds the "hit" -- validated against a real recording of this kind of
 * drum-roll-into-crash sound (see the analysis behind this change), not
 * just assumed. A plain rolling drum is fairly uniform in raw loudness
 * throughout, so comparing raw broadband loudness tends to just catch a
 * random peak inside the roll. What actually distinguishes a crash/hit is
 * a SUSTAINED shift toward high-frequency energy that holds, not a single
 * loud instant -- scored as an absolute increase (not a ratio, which is
 * misleadingly huge right where near-silence gives way to any audible
 * content at all, well before the real hit). A first-order difference
 * (data[i] - data[i-1]) is a cheap, synchronous high-frequency emphasis --
 * no OfflineAudioContext render needed -- that measured within 0ms of a
 * proper highpass filter on real test audio. Returns null if the buffer
 * is too short to compare a meaningful "before" and "after" span at all.
 */
function findLoudestTransientSeconds(buffer) {
  const data = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const windowSize = Math.max(1, Math.round(sampleRate * 0.02)); // 20ms windows
  const windowCount = Math.floor(data.length / windowSize);
  const spanWindows = Math.max(2, Math.round(0.15 / 0.02)); // ~150ms of context each side
  if (windowCount < spanWindows * 2 + 1) return null;

  const energies = new Array(windowCount);
  for (let w = 0; w < windowCount; w++) {
    const start = Math.max(1, w * windowSize);
    const end = Math.min(data.length, start + windowSize);
    let sumSquares = 0;
    for (let i = start; i < end; i++) {
      const diff = data[i] - data[i - 1]; // high-frequency emphasis
      sumSquares += diff * diff;
    }
    energies[w] = Math.sqrt(sumSquares / windowSize);
  }

  let bestWindow = -1;
  let bestIncrease = 0; // require a genuine increase, not just whichever point decreased least
  for (let w = spanWindows; w < windowCount - spanWindows; w++) {
    let before = 0;
    let after = 0;
    for (let i = w - spanWindows; i < w; i++) before += energies[i];
    for (let i = w; i < w + spanWindows; i++) after += energies[i];
    before /= spanWindows;
    after /= spanWindows;
    // Absolute difference, not a ratio: a ratio is misleadingly huge right
    // where near-total silence gives way to any audible content at all
    // (dividing by a near-zero "before" value), even though that's much
    // quieter in absolute terms than the real hit later on.
    const increase = after - before;
    if (increase > bestIncrease) {
      bestIncrease = increase;
      bestWindow = w;
    }
  }
  return bestWindow < 0 ? null : (bestWindow * windowSize) / sampleRate;
}

/** The reveal delay to actually use: the detected hit timing if analysis
 * succeeded, otherwise the fixed default (also what plain <audio> fallback
 * playback uses, since it can't inspect samples to detect anything). */
function getRevealDelayMs() {
  return computedRevealDelayMs !== null ? computedRevealDelayMs : END_REVEAL_MS;
}

/** The offset (in seconds) into the buffer where playback should start --
 * detected lead-in trim if analysis has run, otherwise the fallback constant. */
function getDrumrollPlaybackStartSeconds() {
  return drumrollPlaybackStartSeconds !== null ? drumrollPlaybackStartSeconds : DRUMROLL_START_OFFSET_SECONDS;
}

function primeRevealAudio() {
  if (!isSoundEnabled) return;

  const audioContext = getRevealAudioContext();
  if (audioContext && audioContext.state === "suspended") {
    audioContext.resume().catch(() => {});
  }

  primeDrumrollAudio();
}

function primeDrumrollAudio() {
  if (!isSoundEnabled || !drumrollAudio) return;

  const audio = getDrumrollAudio();
  const primeToken = drumrollPrimeToken + 1;
  drumrollPrimeToken = primeToken;
  audio.muted = true;
  seekAudioToDrumrollStart(audio);

  audio.play()
    .then(() => {
      if (primeToken !== drumrollPrimeToken) return;
      audio.pause();
      // Leave it parked at the trimmed start, not rewound to 0 -- rewinding
      // here would silently reintroduce the seek delay this whole change
      // is meant to avoid, right before the moment it needs to be instant.
      seekAudioToDrumrollStart(audio);
      audio.muted = false;
    })
    .catch(() => {
      if (primeToken === drumrollPrimeToken) {
        audio.muted = false;
      }
    });
}

function getRevealAudioContext() {
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor) return null;

  if (!revealAudioContext) {
    revealAudioContext = new AudioContextConstructor();
  }
  return revealAudioContext;
}

function playRevealImpactSound() {
  if (!isSoundEnabled) return;

  const audioContext = getRevealAudioContext();
  if (!audioContext || audioContext.state === "suspended") return;

  const now = audioContext.currentTime;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(150, now);
  oscillator.frequency.exponentialRampToValueAtTime(44, now + 0.38);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.42, now + 0.018);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.58);
}

/**
 * A synthesized explosion for the confetti burst -- no mp3 to fetch, so
 * none of the network delay this whole change is about, and it's called
 * from the same line that launches the confetti so the two are locked
 * together. A sub-bass "thump" (oscillator) is layered with a filtered
 * white-noise "crack" that sweeps bright-to-dull, like a firework pop.
 */
function playConfettiExplosionSound() {
  if (!isSoundEnabled) return;

  const audioContext = getRevealAudioContext();
  if (!audioContext || audioContext.state === "suspended") return;

  const now = audioContext.currentTime;

  const boom = audioContext.createOscillator();
  const boomGain = audioContext.createGain();
  boom.type = "sine";
  boom.frequency.setValueAtTime(140, now);
  boom.frequency.exponentialRampToValueAtTime(28, now + 0.55);
  boomGain.gain.setValueAtTime(0.0001, now);
  boomGain.gain.exponentialRampToValueAtTime(0.55, now + 0.02);
  boomGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
  boom.connect(boomGain);
  boomGain.connect(audioContext.destination);
  boom.start(now);
  boom.stop(now + 0.95);

  const noiseSource = audioContext.createBufferSource();
  noiseSource.buffer = createNoiseBuffer(audioContext, 0.7);

  const noiseFilter = audioContext.createBiquadFilter();
  noiseFilter.type = "lowpass";
  noiseFilter.frequency.setValueAtTime(7000, now);
  noiseFilter.frequency.exponentialRampToValueAtTime(180, now + 0.65);

  const noiseGain = audioContext.createGain();
  noiseGain.gain.setValueAtTime(0.0001, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.3, now + 0.01);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);

  noiseSource.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(audioContext.destination);
  noiseSource.start(now);
  noiseSource.stop(now + 0.7);
}

/** Builds a short buffer of white noise for the explosion's crackle layer. */
function createNoiseBuffer(audioContext, durationSeconds) {
  const sampleRate = audioContext.sampleRate;
  const length = Math.max(1, Math.floor(sampleRate * durationSeconds));
  const buffer = audioContext.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

/**
 * Plays the decoded drumroll buffer via the Web Audio API. Starting a
 * BufferSourceNode is just scheduling -- no network, no decode-on-demand
 * -- and "offset" skips the silent lead-in the same way
 * DRUMROLL_START_OFFSET_SECONDS did for the <audio> element, but as a
 * plain array index instead of a seek that has to resolve first.
 */
function playDrumrollFromBuffer(buffer) {
  const audioContext = getRevealAudioContext();
  if (!audioContext) {
    playFallbackDrumrollAudio();
    return;
  }
  if (audioContext.state === "suspended") {
    audioContext.resume().catch(() => {});
  }

  stopDrumrollBufferSource();

  const source = audioContext.createBufferSource();
  const gainNode = audioContext.createGain();
  source.buffer = buffer;
  source.connect(gainNode);
  gainNode.connect(audioContext.destination);

  const startVolume = 0.75;
  const now = audioContext.currentTime;
  // Let the detected hit ring for a beat before fading, instead of fading
  // out beforehand -- the reveal is timed to land ON the hit, so cutting
  // the volume before that point would silence the exact moment this is
  // built around.
  const fadeStartSeconds = Math.max(0.05, getRevealDelayMs() / 1000 + 0.15);
  const fadeDurationSeconds = AUDIO_FADE_MS / 1000;

  gainNode.gain.setValueAtTime(startVolume, now);
  gainNode.gain.setValueAtTime(startVolume, now + fadeStartSeconds);
  gainNode.gain.linearRampToValueAtTime(0.0001, now + fadeStartSeconds + fadeDurationSeconds);

  const offset = Math.min(getDrumrollPlaybackStartSeconds(), Math.max(0, buffer.duration - 0.05));
  source.start(now, offset);
  source.stop(now + fadeStartSeconds + fadeDurationSeconds + 0.05);

  drumrollBufferSourceNode = source;
  drumrollGainNode = gainNode;
}

/** Stops and releases the currently-playing buffer source node, if any. */
function stopDrumrollBufferSource() {
  if (drumrollBufferSourceNode) {
    try {
      drumrollBufferSourceNode.stop();
    } catch (error) {
      // Already stopped, or reached the end of the buffer naturally --
      // nothing left to do.
    }
    drumrollBufferSourceNode.disconnect();
    drumrollBufferSourceNode = null;
  }
  if (drumrollGainNode) {
    drumrollGainNode.disconnect();
    drumrollGainNode = null;
  }
}

function playFallbackDrumrollAudio() {
  const audio = getDrumrollAudio();
  activeMemeAudio = audio;
  audio.muted = false;
  audio.pause();
  seekAudioToDrumrollStart(audio);
  audio.volume = 0.75;
  scheduleAudioFadeOut(audio, Math.max(0, getRevealDelayMs() - AUDIO_FADE_MS));
  audio.play().catch(() => handleAudioPlayFailure(audio));
}

function seekAudioToDrumrollStart(audio) {
  // Setting currentTime looks synchronous but isn't: the browser has to
  // seek/decode to the new position before play() actually produces sound.
  // Calling this well ahead of the reveal (preload, priming, any reset)
  // means that work happens while nobody's listening. The threshold check
  // makes a repeat call at reveal time a no-op instead of a fresh seek.
  const applyOffset = () => {
    const targetOffset = getDrumrollPlaybackStartSeconds();
    if (Math.abs(audio.currentTime - targetOffset) > 0.05) {
      audio.currentTime = targetOffset;
    }
  };

  if (audio.readyState >= 1) { // HAVE_METADATA -- currentTime is safe to read/set
    applyOffset();
  } else {
    audio.addEventListener("loadedmetadata", applyOffset, { once: true });
  }
}

function clearEndRevealTimers() {
  clearTimeout(endRevealTimeoutId);
  if (scoreRollIntervalId) {
    clearInterval(scoreRollIntervalId);
    scoreRollIntervalId = null;
  }
  if (endRevealMessageIntervalId) {
    clearInterval(endRevealMessageIntervalId);
    endRevealMessageIntervalId = null;
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
    "var(--gold)",
    "var(--pink)",
    "var(--cyan)",
    "var(--mint)",
  ];
  const pieceCount = 150;

  for (let i = 0; i < pieceCount; i++) {
    const piece = document.createElement("div");
    piece.className = "confetti-piece";
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDuration = `${2.5 + Math.random() * 1.5}s`;
    piece.style.animationDelay = `${Math.random() * 0.4}s`;
    const size = 6 + Math.random() * 6;
    piece.style.width = `${size}px`;
    piece.style.height = `${size * (1 + Math.random())}px`;
    if (Math.random() > 0.5) piece.style.borderRadius = "50%";

    piece.addEventListener("animationend", () => piece.remove());
    confettiContainer.appendChild(piece);
  }
}

function handleCreateNewQuiz() {
  playClick();
  clearTimeout(feedbackTimeoutId);
  clearTimeout(questionTransitionTimeoutId);
  clearEndRevealTimers();
  stopActiveMemeAudio();
  quizQuestions = [];
  currentQuestionIndex = 0;
  score = 0;
  streak = 0;
  isPlaying = false;
  try {
    localStorage.removeItem("quiz-builder-state");
  } catch (e) {
    console.warn("Could not clear state from localStorage:", e);
  }
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
   STATE PERSISTENCE
--------------------------------------------------------------------- */
function saveState() {
  try {
    const state = {
      quizQuestions,
      currentQuestionIndex,
      score,
      streak,
      isPlaying
    };
    localStorage.setItem("quiz-builder-state", JSON.stringify(state));
  } catch (e) {
    console.warn("Could not save state to localStorage:", e);
  }
}

function loadState() {
  try {
    const stateStr = localStorage.getItem("quiz-builder-state");
    if (stateStr) {
      const state = JSON.parse(stateStr);
      quizQuestions = state.quizQuestions || [];
      currentQuestionIndex = state.currentQuestionIndex || 0;
      score = state.score || 0;
      streak = state.streak || 0;
      isPlaying = state.isPlaying || false;
      return true;
    }
  } catch (e) {
    console.warn("Could not load state from localStorage:", e);
  }
  return false;
}

function clearState() {
  try {
    const stateStr = localStorage.getItem("quiz-builder-state");
    if (stateStr) {
      const state = JSON.parse(stateStr);
      const partialState = {
        quizQuestions: state.quizQuestions || [],
        currentQuestionIndex: 0,
        score: 0,
        streak: 0,
        isPlaying: false
      };
      localStorage.setItem("quiz-builder-state", JSON.stringify(partialState));
    }
  } catch (e) {
    console.warn("Could not clear state from localStorage:", e);
  }
}

/* ---------------------------------------------------------------------
   AUDIO SCAFFOLDING
--------------------------------------------------------------------- */

/**
 * Play a correct sound. Users can swap the src with their own .wav/.mp3 file later.
 */
function playCorrectSound() {
  if (!isSoundEnabled) return;
  const audio = new Audio("assets/correct.mp3");
  audio.play().catch(e => console.warn("Audio play failed:", e));
}

/**
 * Play an incorrect sound. Users can swap the src with their own .wav/.mp3 file later.
 */
function playWrongSound() {
  if (!isSoundEnabled) return;
  const audio = new Audio("assets/wrong.mp3");
  audio.play().catch(e => console.warn("Audio play failed:", e));
}

/**
 * Play a generic UI click sound. Users can swap the src with their own .wav/.mp3 file later.
 */
function playClick() {
  if (!isSoundEnabled) return;
  const audio = new Audio("assets/click.mp3");
  audio.play().catch(e => console.warn("Audio play failed:", e));
}


/* ---------------------------------------------------------------------
   8. INIT
   The <script> tag uses `defer`, so the DOM is already fully parsed by
   the time this file runs -- no DOMContentLoaded listener needed.
--------------------------------------------------------------------- */
function init() {
  loadSoundPreference();
  updateSoundToggleVisual();
  preloadDrumrollAudio();
  loadDrumrollAudioBuffer();

  const hasState = loadState();

  renderQuestionList();
  updateStartButtonState();

  if (hasState && isPlaying) {
    showScreen("player");
    loadQuestion();
    updateStreakVisual();
    // Re-apply progress visual since loadQuestion does not do it
    setProgress((currentQuestionIndex) / quizQuestions.length);
  } else {
    showScreen("creator");
  }
}

init();
