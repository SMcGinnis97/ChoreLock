-- Co-parent visibility: record WHICH parent reviewed quests and resolved reward
-- claims (chore_instances.reviewed_by already exists). Powers the parent activity feed.
alter table side_quests add column reviewed_by uuid;
alter table reward_claims add column resolved_by uuid;
