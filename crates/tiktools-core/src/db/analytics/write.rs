use rusqlite::params;

use super::super::sqlite::DatabaseError;
#[cfg(test)]
use super::super::DatabaseManager;
use super::{utc_day, utc_hour, AnalyticsEventRecord};

#[cfg(test)]
impl DatabaseManager {
    pub(crate) fn record_analytics_event(
        &self,
        creator_unique_id: &str,
        record: &AnalyticsEventRecord,
        now_unix: i64,
    ) -> Result<(), DatabaseError> {
        let mut connection = self.open(&self.analytics_path())?;
        let transaction = connection.transaction()?;
        record_analytics_event(&transaction, creator_unique_id, record, now_unix)?;
        transaction.commit()?;
        Ok(())
    }
    pub(crate) fn record_analytics_viewers(
        &self,
        creator_unique_id: &str,
        viewers: i64,
        now_unix: i64,
    ) -> Result<(), DatabaseError> {
        let mut connection = self.open(&self.analytics_path())?;
        let transaction = connection.transaction()?;
        record_analytics_viewers(&transaction, creator_unique_id, viewers, now_unix)?;
        transaction.commit()?;
        Ok(())
    }
    pub(crate) fn open_live_session(
        &self,
        creator_unique_id: &str,
        room_id: Option<&str>,
        now_unix: i64,
    ) -> Result<(), DatabaseError> {
        let mut connection = self.open(&self.analytics_path())?;
        let transaction = connection.transaction()?;
        open_live_session(&transaction, creator_unique_id, room_id, now_unix)?;
        transaction.commit()?;
        Ok(())
    }
    pub(crate) fn close_live_sessions(
        &self,
        creator_unique_id: &str,
        now_unix: i64,
    ) -> Result<(), DatabaseError> {
        let mut connection = self.open(&self.analytics_path())?;
        let transaction = connection.transaction()?;
        close_live_sessions(&transaction, creator_unique_id, now_unix)?;
        transaction.commit()?;
        Ok(())
    }
}

pub(in crate::db) fn record_analytics_event(
    connection: &rusqlite::Connection,
    creator_unique_id: &str,
    record: &AnalyticsEventRecord,
    now_unix: i64,
) -> Result<(), DatabaseError> {
    let day = utc_day(now_unix);
    let hour = utc_hour(now_unix);
    connection.execute(
        "INSERT INTO analytics_daily (
                creator_unique_id, day, chats, gift_events, gifts, diamonds,
                like_events, likes, joins, follows, shares
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
            ON CONFLICT (creator_unique_id, day) DO UPDATE SET
                chats = chats + excluded.chats,
                gift_events = gift_events + excluded.gift_events,
                gifts = gifts + excluded.gifts,
                diamonds = diamonds + excluded.diamonds,
                like_events = like_events + excluded.like_events,
                likes = likes + excluded.likes,
                joins = joins + excluded.joins,
                follows = follows + excluded.follows,
                shares = shares + excluded.shares",
        params![
            creator_unique_id,
            day,
            record.chats,
            record.gift_events,
            record.gifts,
            record.diamonds,
            record.like_events,
            record.likes,
            record.joins,
            record.follows,
            record.shares,
        ],
    )?;
    connection.execute(
        "INSERT INTO analytics_hourly (
                creator_unique_id, hour, chats, gift_events, gifts, diamonds,
                like_events, likes, joins, follows, shares
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
            ON CONFLICT (creator_unique_id, hour) DO UPDATE SET
                chats = chats + excluded.chats,
                gift_events = gift_events + excluded.gift_events,
                gifts = gifts + excluded.gifts,
                diamonds = diamonds + excluded.diamonds,
                like_events = like_events + excluded.like_events,
                likes = likes + excluded.likes,
                joins = joins + excluded.joins,
                follows = follows + excluded.follows,
                shares = shares + excluded.shares",
        params![
            creator_unique_id,
            hour,
            record.chats,
            record.gift_events,
            record.gifts,
            record.diamonds,
            record.like_events,
            record.likes,
            record.joins,
            record.follows,
            record.shares,
        ],
    )?;
    if !record.unique_id.is_empty() {
        connection.execute(
            "INSERT INTO viewer_daily (
                    creator_unique_id, day, unique_id, chats, gifts, diamonds,
                    likes, shares, first_seen, last_seen
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
                ON CONFLICT (creator_unique_id, day, unique_id) DO UPDATE SET
                    chats = chats + excluded.chats,
                    gifts = gifts + excluded.gifts,
                    diamonds = diamonds + excluded.diamonds,
                    likes = likes + excluded.likes,
                    shares = shares + excluded.shares,
                    first_seen = MIN(first_seen, excluded.first_seen),
                    last_seen = MAX(last_seen, excluded.last_seen)",
            params![
                creator_unique_id,
                day,
                record.unique_id,
                record.chats,
                record.gifts,
                record.diamonds,
                record.likes,
                record.shares,
                now_unix,
            ],
        )?;
    }
    Ok(())
}

pub(in crate::db) fn record_analytics_viewers(
    connection: &rusqlite::Connection,
    creator_unique_id: &str,
    viewers: i64,
    now_unix: i64,
) -> Result<(), DatabaseError> {
    let day = utc_day(now_unix);
    let hour = utc_hour(now_unix);
    connection.execute(
        "INSERT INTO analytics_daily (creator_unique_id, day, peak_viewers)
             VALUES (?1, ?2, ?3)
             ON CONFLICT (creator_unique_id, day) DO UPDATE SET
                peak_viewers = MAX(peak_viewers, excluded.peak_viewers)",
        params![creator_unique_id, day, viewers.max(0)],
    )?;
    connection.execute(
        "INSERT INTO analytics_hourly (creator_unique_id, hour, peak_viewers)
             VALUES (?1, ?2, ?3)
             ON CONFLICT (creator_unique_id, hour) DO UPDATE SET
                peak_viewers = MAX(peak_viewers, excluded.peak_viewers)",
        params![creator_unique_id, hour, viewers.max(0)],
    )?;
    connection.execute(
        "UPDATE live_sessions SET peak_viewers = MAX(peak_viewers, ?1)
             WHERE creator_unique_id = ?2 AND ended_at IS NULL",
        params![viewers.max(0), creator_unique_id],
    )?;
    Ok(())
}

pub(in crate::db) fn open_live_session(
    connection: &rusqlite::Connection,
    creator_unique_id: &str,
    room_id: Option<&str>,
    now_unix: i64,
) -> Result<(), DatabaseError> {
    connection.execute(
        "UPDATE live_sessions SET ended_at = ?1
             WHERE creator_unique_id = ?2 AND ended_at IS NULL",
        params![now_unix, creator_unique_id],
    )?;
    connection.execute(
        "INSERT INTO live_sessions (creator_unique_id, room_id, started_at)
             VALUES (?1, ?2, ?3)",
        params![creator_unique_id, room_id, now_unix],
    )?;
    Ok(())
}

pub(in crate::db) fn close_live_sessions(
    connection: &rusqlite::Connection,
    creator_unique_id: &str,
    now_unix: i64,
) -> Result<(), DatabaseError> {
    connection.execute(
        "UPDATE live_sessions SET ended_at = ?1
             WHERE creator_unique_id = ?2 AND ended_at IS NULL",
        params![now_unix, creator_unique_id],
    )?;
    Ok(())
}
