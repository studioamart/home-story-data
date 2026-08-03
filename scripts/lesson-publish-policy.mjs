/** A guide is public only after explicit boolean verification. */
export function isPublishableLesson(lesson) {
  return lesson?.verified === true;
}
